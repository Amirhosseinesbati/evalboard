/* Blocking, same-origin bootstrap: compatible with script-src 'self'.
   Keep the key and accepted values in sync with src/lib/theme.ts. */
(function () {
  var preference = 'dark'
  try {
    var saved = localStorage.getItem('evalboard.theme.v1')
    if (saved === 'light' || saved === 'dark' || saved === 'system') preference = saved
  } catch { /* Storage is optional; the fresh default is dark. */ }
  var theme = preference
  if (preference === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  document.documentElement.dataset.theme = theme
  document.documentElement.dataset.themePreference = preference
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#0b1018' : '#f3f5f8')
})()
