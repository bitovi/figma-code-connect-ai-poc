# Superconnect: Figma ↔ Code Connect Generator

Superconnect is an AI-enhanced tool that writes your Figma Code Connect files for you. It takes these inputs:

- A Figma design system file
- An associated component repo (assumed to be React + Typescript)

And it outputs (in your repo):

- `figma.config.json` at top level
- `codeconnect/` directory with Figma Code Connect `.figma.tsx` files
- Summary and intermediate files in `superconnect/`



