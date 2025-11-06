# Figma Code Connect - AI POC

This project provides utilities for working with Figma Code Connect configuration and component data extraction.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# View all available commands
npm run help

# Complete workflow: Extract components + Generate config
npm run workflow:complete

# Quick Chakra UI style setup
npm run workflow:chakra
```

## 📋 Available Commands

### Component Extraction

- `npm run fetch:components` - Extract all components from Figma
- `npm run fetch:help` - Show component extraction options

### Configuration Generation

- `npm run build:config` - Generate config (console output)
- `npm run build:config:file` - Generate figma.config.json file
- `npm run build:config:help` - Show configuration options

### Quick Setups

- `npm run setup:chakra` - Generate Chakra UI style configuration
- `npm run setup:basic` - Generate basic design system configuration

### Complete Workflows

- `npm run workflow:complete` - Extract components → Generate config
- `npm run workflow:chakra` - Extract components → Chakra UI setup

### Development Tools

- `npm run dev:preview` - Preview configuration without generating file
- `npm run dev:check` - Check script syntax

## 📖 Detailed Documentation

For comprehensive usage instructions, examples, and troubleshooting, see [`scripts/README.md`](scripts/README.md).

## ⚙️ Setup

1. **Clone the repository**
2. **Install dependencies**: `npm install`
3. **Configure environment**: Create `.env` file with:

   ```bash
   FIGMA_ACCESS_TOKEN=your_figma_token
   FIGMA_FILE_KEY=your_figma_file_key
   ```

4. **Run commands**: Use `npm run help` to see all available options
