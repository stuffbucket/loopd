# Releasing loopd

This document describes the release process for loopd.

## Prerequisites

1. **GitHub Repository**: `stuffbucket/loopd` (this repo)
2. **Homebrew Tap Repository**: `stuffbucket/homebrew-tap` (must be created separately)
3. **GitHub Personal Access Token**: With `repo` scope for the homebrew-tap repo

## Setting Up the Homebrew Tap

Create a new repository at `github.com/stuffbucket/homebrew-tap`:

```bash
# Create the repo on GitHub first, then:
git clone git@github.com-stuffbucket:stuffbucket/homebrew-tap.git
cd homebrew-tap
mkdir Formula
touch README.md
git add .
git commit -m "Initial homebrew tap setup"
git push -u origin main
```

## Configuring Secrets

In the `stuffbucket/loopd` repository settings, add the following secret:

- **Name**: `HOMEBREW_TAP_TOKEN`
- **Value**: A GitHub Personal Access Token with `repo` scope that can push to `stuffbucket/homebrew-tap`

## Creating a Release

1. **Tag the release**:
   ```bash
   git tag -a v0.1.0 -m "Release v0.1.0"
   git push stuffbucket v0.1.0
   ```

2. **GoReleaser runs automatically** via GitHub Actions when the tag is pushed

3. **What happens**:
   - Builds binaries for Linux, macOS, and Windows (amd64 and arm64)
   - Creates GitHub release with archives and checksums
   - Updates the Homebrew formula in `stuffbucket/homebrew-tap`

## Installing via Homebrew

Once released, users can install with:

```bash
brew tap stuffbucket/tap
brew install loopd
```

Or in one command:

```bash
brew install stuffbucket/tap/loopd
```

## Manual Testing Before Release

Test the GoReleaser configuration locally:

```bash
# Dry run (no publishing)
goreleaser release --snapshot --clean

# Check generated archives
ls dist/
```

## Version Scheme

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes to CLI interface or behavior
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes, backward compatible

Pre-release versions: `v0.1.0-alpha.1`, `v0.1.0-beta.1`, `v0.1.0-rc.1`
