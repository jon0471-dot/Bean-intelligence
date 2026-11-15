// Ambient module declaration for the Vanta UMD effect bundles (BEAN toolkit).
declare module 'vanta/dist/*' {
  const VantaBundle: Record<string, unknown> & { default?: Record<string, unknown> }
  export default VantaBundle
}
