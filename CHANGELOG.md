# Changelog

All notable changes to ParthSeva Manager are documented in this file.

## [Unreleased]

### Changed

- Structure Matcher: drag and drop spreadsheet files onto either file panel instead of using the picker.
- Structure Matcher: the Name column is now suggested more reliably for headerless sheets by preferring columns filled with name-like values (not phone numbers, dates or amounts).
- Structure Matcher: added a name search box with "Select matching", and a one-click **Reorder & save** action that builds and saves the result in a single step.
- Structure Matcher: the selection list is now labelled "Select the File B rows to reorder", shows File B row and File A position numbers, and a "Choose File B rows…" button jumps straight to it.
- Structure Matcher: File B rows that cannot be reordered (no match, duplicate name, or no name) are listed with the reason.
- Structure Matcher: the projected output row count now follows the current selection.

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
