# Changelog

All notable changes to ParthSeva Manager are documented in this file.

## [0.2.0] - 2026-11-09

### Added

- Offline-first Windows desktop workflow for finding and reviewing daily ParthSeva files.
- Birthday recipient import, message templates, queue preparation, and sending workflow.
- Local ParthSender Chrome extension pairing, connection status, and extension download.
- Seva List editor with donor sections, notes, per-name sizing, side-by-side layout, print/PDF support, and editable Word export.
- Automatically generated Mangal Aarti and lunch announcement text.
- Light and dark themes with a persistent top-right theme control.

### Changed

- Made ParthSeva folder configuration optional at startup and kept it available in Settings.
- Made the donor editor grow with the page instead of using a separate internal scrollbar.
- Defined Seva name sizes in points so an editor value such as `111` exports as `111 pt` in Word.
- Automatically opens a downloaded Seva Word document in the system's default compatible application.

### Fixed

- Ensured global and individual Seva name-size changes are retained in downloaded Word documents.
- Limited donor add, edit, and remove operations to the selected Seva section.
- When an existing Word document is open and locked, saves and opens the next available numbered copy instead of failing.
- Improved Seva Notice rendering and dark-theme styling.

### Breaking Changes

- None.
