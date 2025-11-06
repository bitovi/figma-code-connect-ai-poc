# Figma Code Connect AI POC - TODO

## Project Overview

This project demonstrates automated Figma Code Connect integration using AI to bridge design and code.

---

## Phase 1: Component Discovery (COMPLETED)

- [x] Fetch Figma components via API (`fetchComponents.js`)
- [x] Parse component variants and properties
- [x] Generate YAML files in `figma-variants/` directory
- [x] Build Figma configuration (`buildFigmaConfig.js`)

---

## Phase 2: Code Analysis (COMPLETED)

- [x] Create component props extraction script (`extractComponentProps.js`)
- [x] Scan React TypeScript components in `chakra-ui/apps/compositions/src/ui/`
- [x] Extract component interfaces and prop types
- [x] Generate YAML files in `components-props/` directory (226 components extracted)
- [x] Fix exported interface detection bug
- [x] Validate prop extraction across all components

---

## Phase 3: Figma Design Updates (IN PROGRESS)

### Recreate Components in Figma

Update Figma file components to match Code Connect structure:

- [x] **Button Component**
  - [x] Recreate with proper variants matching `ButtonProps`
  - [x] Ensure variant properties align with code (size, variant, colorPalette, loading, disabled)
  - [x] Test Code Connect mapping

- [x] **Alert Component**
  - [x] Recreate with proper variants matching `AlertProps`
  - [x] Ensure variant properties align with code (startElement, endElement, title, icon)
  - [x] Test Code Connect mapping

- [ ] **Avatar Component**
  - [ ] Recreate with proper variants matching `AvatarProps`
  - [ ] Ensure variant properties align with code (size, variant, shape, etc.)
  - [ ] Test Code Connect mapping

- [ ] **Accordion Component**
  - [ ] Recreate with proper variants matching `AccordionProps`
  - [ ] Ensure variant properties align with code (variant, size, collapsible, etc.)
  - [ ] Test Code Connect mapping

### Design Requirements

- [ ] Match extracted component props from `components-props/` YAML files
- [ ] Use consistent naming between Figma variants and code props
- [ ] Ensure all boolean props have corresponding boolean variants
- [ ] Align enum values between Figma and code
- [ ] Test that Code Connect mappings work correctly

---

## Phase 4: Automated Code Connect Generation (PLANNED)

- [ ] Create script to match `components-props/` with `figma-variants/`
- [ ] Generate `.figma.tsx` Code Connect files automatically
- [ ] Validate generated mappings
- [ ] Test end-to-end workflow

---

## Phase 5: Integration & Testing (PLANNED)

- [ ] Set up automated testing for Code Connect
- [ ] Create documentation for the workflow
- [ ] Implement CI/CD integration
- [ ] Create demo showcasing the complete flow
