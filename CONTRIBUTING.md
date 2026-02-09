# Contributing to Claude Conduit

Thanks for your interest in contributing! Claude Conduit is a small project and we welcome PRs of all sizes.

## Development Setup

### Daemon

```bash
cd daemon
npm install
npm run dev          # tsx watch mode (auto-restarts on changes)
```

Verify it's running:

```bash
curl http://localhost:7860/api/status
```

### Mobile App

```bash
cd mobile
npm install
cd ios && pod install && cd ..
npx react-native run-ios --simulator="iPhone 16"
```

Requires Xcode 15+ and CocoaPods.

## Before Submitting a PR

1. **Type-check both packages:**

```bash
cd daemon && npx tsc --noEmit
cd mobile && npx tsc --noEmit
```

2. **Test manually** — connect the mobile app to the daemon and verify your change works end-to-end.

3. **Keep changes focused** — one feature or fix per PR. Smaller PRs get reviewed faster.

## Code Style

- TypeScript strict mode everywhere
- No `any` types — use `unknown` and narrow
- Prefer early returns over nested conditionals
- Error responses follow the standard format:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable message",
  "action": "What the user should do"
}
```

## Project Structure

- **`daemon/`** — Node.js service (Fastify, node-pty, tmux)
- **`mobile/`** — React Native iOS app (xterm.js in WebView)

See [CLAUDE.md](CLAUDE.md) for detailed architecture notes.

## Reporting Issues

- Use the [bug report template](https://github.com/A-Somniatore/claude-conduit/issues/new?template=bug_report.md) for bugs
- Use the [feature request template](https://github.com/A-Somniatore/claude-conduit/issues/new?template=feature_request.md) for ideas
- Include your Node.js version, macOS version, and relevant logs

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
