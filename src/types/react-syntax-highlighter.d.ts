// Minimal ambient types for react-syntax-highlighter (no @types package in
// this environment). Only the Prism surface RIISHE uses is declared.
declare module 'react-syntax-highlighter' {
  import type { ComponentType, ReactNode } from 'react'
  export interface SyntaxHighlighterProps {
    language?: string
    style?: Record<string, Record<string, string>>
    children?: string | string[]
    className?: string
    wrapLongLines?: boolean
    showLineNumbers?: boolean
    customStyle?: Record<string, string | number>
    [key: string]: unknown
  }
  export const Prism: ComponentType<SyntaxHighlighterProps>
  export const Light: ComponentType<SyntaxHighlighterProps>
  export type { ReactNode }
}

declare module 'react-syntax-highlighter/dist/esm/styles/prism' {
  export const vscDarkPlus: Record<string, Record<string, string>>
  export const oneDark: Record<string, Record<string, string>>
}
