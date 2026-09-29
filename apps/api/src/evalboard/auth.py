"""Workspace-scoped cookie sessions; no demo authorization bypass."""

import hashlib
import secrets
from datetime import timedelta, timezone

from fastapi import Cookie, Depends, HTTPException, Response, status
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session

from evalboard.config import get_settings
from evalboard.db import get_db
from evalboard.models import LoginSession, User, Workspace, now

passwords = PasswordHash.recommended()
COOKIE_NAME = "evalboard_session"


def login(db: Session, username: str, password: str, response: Response) -> User:
    user = db.scalar(select(User).where(User.username == username, User.active.is_(True)))
    if not user or not passwords.verify(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = secrets.token_urlsafe(32)
    db.add(LoginSession(
        user_id=user.id,
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        expires_at=now() + timedelta(hours=get_settings().session_hours),
    ))
    db.commit()
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=get_settings().session_hours * 3600,
        httponly=True,
        secure=get_settings().session_cookie_secure,
        samesite="lax",
        path="/",
    )
    return user


def current_user(
    evalboard_session: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not evalboard_session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login required")
    hashed = hashlib.sha256(evalboard_session.encode()).hexdigest()
    record = db.scalar(select(LoginSession).where(LoginSession.token_hash == hashed))
    if not record:
        raise HTTPException(status_code=401, detail="Session expired")
    expiration = record.expires_at
    if expiration.tzinfo is None:
        expiration = expiration.replace(tzinfo=timezone.utc)
    if expiration <= now():
        db.delete(record)
        db.commit()
        raise HTTPException(status_code=401, detail="Session expired")
    user = db.get(User, record.user_id)
    if not user or not user.active:
        raise HTTPException(status_code=401, detail="Account unavailable")
    return user


def require_write(user: User = Depends(current_user)) -> User:
    if user.role not in ("admin", "operator"):
        raise HTTPException(status_code=403, detail="Operator role required")
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return user


def require_review(user: User = Depends(current_user)) -> User:
    if user.role not in ("admin", "operator", "reviewer"):
        raise HTTPException(status_code=403, detail="Reviewer role required")
    return user


def user_public(db: Session, user: User) -> dict:
    workspace = db.get(Workspace, user.workspace_id)
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "workspace_id": user.workspace_id,
        "workspace_name": workspace.name if workspace else "Unknown workspace",
    }
