#!/usr/bin/env node
const { execSync, spawnSync } = require('child_process')
const { existsSync, mkdirSync } = require('fs')
const { symlink } = require('fs/promises')
const path = require('path')
const os = require('os')

const SKILL_DIR = path.resolve(__dirname, '..')
const HOME = os.homedir()

const AGENTS = {
  'Claude Code (default)': path.join(HOME, '.claude', 'skills', 'tell'),
  'Claude Code (claude-work)': path.join(HOME, '.claude-work', 'skills', 'tell'),
  'Pi': path.join(HOME, '.pi', 'agent', 'skills', 'tell'),
  'OpenCode': path.join(HOME, '.opencode', 'skills', 'tell'),
}

async function install() {
  let installed = 0

  for (const [agent, target] of Object.entries(AGENTS)) {
    const dir = path.dirname(target)
    if (!existsSync(dir)) continue  // agent not installed, skip

    if (existsSync(target)) {
      console.log(`  ${agent}: already installed`)
      installed++
      continue
    }

    mkdirSync(dir, { recursive: true })
    await symlink(SKILL_DIR, target)
    console.log(`  ${agent}: installed`)
    installed++
  }

  if (installed === 0) {
    console.log('No supported agents found. Manual setup:')
    console.log(`  ln -s ${SKILL_DIR} ~/.claude/skills/tell`)
  } else {
    console.log('\nDone. Restart your agent and run /tell')
  }
}

install().catch(err => {
  console.error('Install failed:', err.message)
  process.exit(1)
})
