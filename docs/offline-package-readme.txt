OPEN WATERHAMMER - VERSIONED OFFLINE BROWSER BUILD

This archive is a static browser application. It does not include a server and must not
be opened directly with file:// because ES Modules and WebAssembly require HTTP.

Example local launch:
  python -m http.server 8080 --directory <extracted-directory>

Then open:
  http://127.0.0.1:8080/

For sensitive infrastructure data, serve this exact version inside the organization,
verify the release SHA-256 before use, and use a dedicated browser profile without
unnecessary extensions. Browser IndexedDB and exported .owhproj files are not encrypted
vaults; manage them under the organization's information-security rules.

Source and license:
  https://github.com/russENG/open-waterhammer
  AGPL-3.0-or-later

Detailed instructions:
  docs/offline-use.md in the corresponding source tag
