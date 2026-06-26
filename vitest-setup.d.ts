import { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

declare module 'vitest' {
  export interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  export interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
