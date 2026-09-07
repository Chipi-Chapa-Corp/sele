declare module '*?raw' {
  const content: string
  // eslint-disable-next-line no-restricted-syntax -- Vite raw imports have a default string export.
  export default content
}
