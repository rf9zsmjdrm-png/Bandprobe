# GitHub-Push (Bandprobe)
- Remote `origin` = https://github.com/rf9zsmjdrm-png/Bandprobe.git (öffentlich), Branch `main`.
- Push per HTTPS; Token (Fine-grained, Contents: Read and write, Repos Bandprobe + WebDev_commercial) liegt im macOS-Schlüsselbund (`osxkeychain`).
- Push/Commit nur auf Julius' Wunsch. Token nie im Chat; Claude kann keine Passwort-Abfrage ausfüllen → Julius pusht beim ersten Mal selbst im Terminal.
- Token abgelaufen/403: alten Eintrag löschen, danach `git push` und Token als Passwort eingeben:
  `printf "protocol=https\nhost=github.com\n\n" | git credential-osxkeychain erase`
- Nach Push: Mini App live nach 1–2 Min., `app.js` nach ≤10 Min. (CLAUDE.md).
- Claude: `GIT_TERMINAL_PROMPT=0 git fetch origin` zum Prüfen (Repo öffentlich, Lesen ohne Token).
