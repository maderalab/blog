# Gathered Light · A Literary Personal Blog

A **ready-to-use**, fully static blog: just drop content into `docs/` and push to GitHub — it builds and goes live automatically. Nothing to install or run locally.

- Each **sub-folder** of `docs/` becomes a card on the home page, classified automatically:
  - contains `.md` → an **article collection** (opens to an article list, then a reader)
  - images only → a **photo album** (opens to a gallery with a lightbox)

## Deploy (one-time setup)

1. Push this repository to GitHub.
2. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Done. Visit `https://<username>.github.io/<repo>/`.

## Updating content

```bash
# Add a folder under docs/: .md makes a collection, images make an album
git add docs
git commit -m "Add content"
git push          # the push triggers an automatic build & deploy to GitHub Pages
```

After each push, watch the build under the repo's **Actions** tab — the site updates once it's green.
You can also re-publish manually with **Run workflow** on the Actions page.
