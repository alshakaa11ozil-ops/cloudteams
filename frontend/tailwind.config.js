// tailwind.config.js
// PURPOSE: Tells Tailwind which files to scan for class names.
// Tailwind uses "purging" — it only includes CSS classes that actually
// appear in your source files. If you don't tell it where to look,
// it generates no CSS at all.

/** @type {import('tailwindcss').Config} */
export default {
  // "content" is the list of files Tailwind will scan.
  // It looks for any string that matches a Tailwind class name.
  content: [
    "./index.html",             // The root HTML file (React mounts here)
    "./src/**/*.{js,ts,jsx,tsx}" // Every JS/TS/JSX/TSX file in src/
    // The ** means "any folder depth"
    // The {js,ts,jsx,tsx} means "any of these four extensions"
  ],
  theme: {
    extend: {
      // We can add custom colors, fonts, spacing here later.
      // For now, we use Tailwind's built-in defaults.
    },
  },
  plugins: [],
}