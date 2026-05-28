# Releasing PandoraBox

Releases are cut manually by the maintainer. There is no CI/CD pipeline, code
signing, or auto-update service.

## Checklist

1. Update `CHANGELOG.md` with the release date and highlights.
2. Set the release version in `ui/package.json` and `ui/package-lock.json`.
3. Run the full build gate:

   ```bash
   make build
   make test
   ```

4. Build release artifacts:

   ```bash
   scripts/release.sh
   ```

5. Create and push the tag:

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

6. Create the GitHub release and upload the artifacts printed by
   `scripts/release.sh`.

For the public launch reset, remove any pre-public releases and tags only after
confirming the destructive operation explicitly.
