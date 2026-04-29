default:
  @just --list

# Init git, create GitHub repo, and push initial commit
setup:
  git init
  git add .
  git commit -m "chore: initial release"
  gh repo create williycole/tell --public --source=. --remote=origin --push

# Bump patch version, commit, tag, push, and publish to npm
release bump="patch":
  npm version {{bump}} --no-git-tag-version
  git add package.json
  git commit -m "chore: release $(node -p "require('./package.json').version")"
  git tag "v$(node -p "require('./package.json').version")"
  git push origin main --tags
  npm publish --access public
