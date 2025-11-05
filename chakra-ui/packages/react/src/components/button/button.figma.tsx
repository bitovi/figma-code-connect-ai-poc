import { figma } from "@figma/code-connect"
import { Button } from "./button"

// Main Button component
figma.connect(Button, "<BUTTON>", {
  props: {
    children: figma.string("Text"),
    size: figma.enum("Size", {
      "xs": "xs",
      "sm": "sm", 
      "md": "md",
      "lg": "lg",
      "xl": "xl"
    }),
    variant: figma.enum("Variant", {
      "solid": "solid",
      "outline": "outline", 
      "ghost": "ghost",
      "plain": "plain"
    }),
    colorPalette: figma.enum("Color", {
      "gray": "gray",
      "red": "red",
      "orange": "orange", 
      "yellow": "yellow",
      "green": "green",
      "teal": "teal",
      "blue": "blue",
      "cyan": "cyan",
      "purple": "purple",
      "pink": "pink"
    }),
    loading: figma.boolean("Loading"),
    disabled: figma.boolean("Disabled")
  },
  example: (props) => (
    <Button 
      size={props.size}
      variant={props.variant}
      colorPalette={props.colorPalette}
      loading={props.loading}
      disabled={props.disabled}
    >
      {props.children}
    </Button>
  )
})

// Button with loading state
figma.connect(Button, "<BUTTON>", {
  variant: { "Loading": true },
  props: {
    children: figma.string("Text"),
    loadingText: figma.string("Loading Text"),
    size: figma.enum("Size", {
      "xs": "xs",
      "sm": "sm", 
      "md": "md",
      "lg": "lg",
      "xl": "xl"
    })
  },
  example: (props) => (
    <Button 
      loading
      loadingText={props.loadingText}
      size={props.size}
    >
      {props.children}
    </Button>
  )
})