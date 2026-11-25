---
section: fixed
---

- **A build run from source no longer reports an update that isn't one.** The repository keeps upstream's package version, so a source build compared that with CodeHarden's version on npm and always showed the update banner, even for a release older than the checkout. It now compares with the CodeHarden version it was built from (the `VERSION` file), so the banner appears only when npm has something newer, and still says to pull and rebuild. Installed and desktop builds compare as before.
- **Update messages say CodeHarden.** The update banner in each of its states, "What's new", the help of the Updates setting, the desktop app's restart hint and the messages of `codeharden update` named CodeDen as the thing being updated; they now use the product's name.
