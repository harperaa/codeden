---
section: changed
---

- **A hold you place stays until you lift it.** In the software factory, the project manager's `factory_release_issue` now releases only holds the project manager placed itself. An issue you labelled `factory:hold` on GitHub, or held yourself, stays held until a person takes the label off: the project manager is told so when it tries to release it or to hold it again, and its `triage_issue` no longer adds or removes that label.
