declare module '*?raw' {
  const content: string
  // biome-ignore lint/style/noDefaultExport: Vite raw imports have a default string export.
  export default content
}
