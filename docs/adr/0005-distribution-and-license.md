# ADR-0005: Repository, license and distribution

- Status: Accepted
- Date: 2026-10-28

## Decision

- Canonical public repository on GitHub.
- License: Apache-2.0 (permissive, with an explicit patent grant). AGPL was rejected: a closed SaaS fork is unlikely for this kind of tool and AGPL discourages contributions.
- Distribution: multi-arch container image on GHCR, built by GitHub Actions, semver tags. Deployments pin an exact tag.
- All repository artefacts (code, docs, ADRs) are in English.

## Consequences

- Deployments (including the author's own) consume the published image and keep their `asmodeus.yaml` and secrets in their own infra repository.
