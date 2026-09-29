import math
import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

TaskType = Literal["grounded_qa", "tool_use", "structured_extraction", "abstention", "adversarial"]
Split = Literal["development", "held_out"]


class CasePayload(BaseModel):
    case_key: str = Field(min_length=1, max_length=80)
    task_type: TaskType
    split: Split
    input: dict[str, Any]
    expected: dict[str, Any]
    context: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)

    @field_validator("input", "expected")
    @classmethod
    def nonempty(cls, value: dict[str, Any]) -> dict[str, Any]:
        if not value:
            raise ValueError("must not be empty")
        return value


class DatasetImport(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    description: str = ""
    jsonl: str = Field(min_length=2)


class CaseEdit(BaseModel):
    case: CasePayload


class TargetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    kind: Literal["bundled", "http", "openai", "recorded"]
    endpoint: str | None = None
    secret_ref: str | None = None
    recorded_outputs: dict[str, Any] | None = None


class ConfigCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    target_id: str
    model_id: str = Field(min_length=1, max_length=160)
    prompt: str = Field(default="Answer based only on the supplied evidence.", max_length=8000)
    options: dict[str, Any] = Field(default_factory=dict)
    budget_usd: float | None = Field(default=None, ge=0)
    concurrency: int = Field(default=2, ge=1, le=8)

    @field_validator("budget_usd")
    @classmethod
    def finite_budget(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("budget_usd must be finite")
        return value

    @field_validator("options")
    @classmethod
    def validate_options(cls, options: dict[str, Any]) -> dict[str, Any]:
        allowed = {
            "prices_per_million_tokens", "max_input_tokens", "max_output_tokens",
            "work_ms", "policy_variant", "tool_names", "retrieval_mode", "temperature",
        }
        unknown = set(options) - allowed
        if unknown:
            raise ValueError(f"unsupported option keys: {', '.join(sorted(unknown))}")
        prices = options.get("prices_per_million_tokens")
        if prices is not None:
            if not isinstance(prices, dict) or set(prices) != {"input", "output"}:
                raise ValueError("prices_per_million_tokens needs input and output")
            if any(isinstance(value, bool) or not isinstance(value, (int, float))
                   or not math.isfinite(value) or value < 0 for value in prices.values()):
                raise ValueError("token prices must be finite nonnegative numbers")
        for key in ("max_input_tokens", "max_output_tokens"):
            value = options.get(key)
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value <= 0):
                raise ValueError(f"{key} must be a positive integer")
        work_ms = options.get("work_ms")
        if work_ms is not None and (isinstance(work_ms, bool) or not isinstance(work_ms, (int, float)) or not math.isfinite(work_ms) or not 0 <= work_ms <= 200):
            raise ValueError("work_ms must be a finite number from 0 to 200")
        variant = options.get("policy_variant")
        if variant is not None and variant not in {"correct", "legacy_90_days"}:
            raise ValueError("unsupported policy_variant")
        tool_names = options.get("tool_names")
        if tool_names is not None and (not isinstance(tool_names, list) or len(tool_names) > 10 or any(not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,39}", name) for name in tool_names)):
            raise ValueError("tool_names must be an array of safe tool identifiers")
        retrieval_mode = options.get("retrieval_mode")
        if retrieval_mode is not None and retrieval_mode not in {"provided_context", "none"}:
            raise ValueError("unsupported retrieval_mode")
        temperature = options.get("temperature")
        if temperature is not None and (isinstance(temperature, bool) or not isinstance(temperature, (int, float)) or not math.isfinite(temperature) or not 0 <= temperature <= 2):
            raise ValueError("temperature must be a finite number from 0 to 2")
        return options


class ExperimentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    dataset_version_id: str
    candidate_a_id: str
    candidate_b_id: str
    split: Literal["development", "held_out", "all"] = "development"
    max_cases: int | None = Field(default=None, ge=1, le=240)
    repetitions: int = Field(default=1, ge=1, le=5)
    budget_usd: float | None = Field(default=None, ge=0)
    gate_id: str | None = None

    @field_validator("budget_usd")
    @classmethod
    def finite_budget(cls, value: float | None) -> float | None:
        if value is not None and not math.isfinite(value):
            raise ValueError("budget_usd must be finite")
        return value


class GateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    thresholds: dict[str, float] = Field(default_factory=dict)

    @field_validator("thresholds")
    @classmethod
    def validate_thresholds(cls, thresholds: dict[str, float]) -> dict[str, float]:
        tasks = {"grounded_qa", "tool_use", "structured_extraction", "abstention", "adversarial"}
        allowed = {"max_regressions", "min_task_delta"} | {f"min_{task}_delta" for task in tasks}
        for key, value in thresholds.items():
            if key not in allowed or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"invalid gate threshold: {key}")
            if key == "max_regressions":
                if value < 0 or not float(value).is_integer():
                    raise ValueError("max_regressions must be a nonnegative integer")
            elif not -1 <= value <= 1:
                raise ValueError(f"{key} must be between -1 and 1")
        return thresholds


class ReviewInput(BaseModel):
    label: Literal["left", "right", "tie", "both_bad"]
    score: float | None = Field(default=None, ge=0, le=5)
    notes: str = Field(default="", max_length=4000)
