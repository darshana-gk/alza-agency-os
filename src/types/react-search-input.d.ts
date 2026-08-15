import type { FormEventHandler, InputHTMLAttributes } from 'react'

/**
 * Native `input[type=search]` fires a non-standard `search` event (e.g. clear "x").
 * React's DOM typings omit `onSearch`; extend InputHTMLAttributes so existing usage typechecks.
 */
declare module 'react' {
  interface InputHTMLAttributes<T> {
    onSearch?: FormEventHandler<T>
  }
}

export {}
