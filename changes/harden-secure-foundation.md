---
section: added
---

- **Secure Foundation, a third way to add a project.** The add-project dialog can create a new project from the Secure Vibe Coding OS template (Next.js, Clerk, Convex, optionally Doppler). One form collects the project name, the admin email, where secrets live and which content modules to install; a confirm step lists what will be installed and what is created in your Clerk, Convex and Doppler accounts; then a setup session runs the template's install with those answers, starts the app and reports its URL. The project page shows the setup's status and a button to claim the Clerk app. See [Secure Foundation](docs/secure-foundation.md).
- **Secure Foundation checks your sign-ins first.** A Connections step shows whether this computer is signed in to Convex (and Doppler, when chosen), with a button that starts that service's own login and shows its link and code, and a choice of Convex team when you have several. The setup that follows reuses those sign-ins.
- **Secure Foundation can also publish the new project.** An option, off by default, creates a private GitHub repository and a Vercel project and deploys the site with the template's dev route. The form shows your GitHub and Vercel sign-ins, lets you pick the repository's owner and name and the Vercel scope, and lists everything that will be created before you confirm.
