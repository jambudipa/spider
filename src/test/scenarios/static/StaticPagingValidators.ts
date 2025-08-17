/**
 * Static Paging Validators - STUB FILE
 * Data validation utilities for static pagination tests
 */

import { Effect } from 'effect';

/**
 * Validation result type
 */
export interface ValidationResult {
  readonly isValid: boolean;
  readonly errors?: string[];
}

/**
 * Product data structure
 */
export interface ProductData {
  readonly id?: string;
  readonly name: string;
  readonly price?: string;
  readonly description?: string;
  readonly image?: string;
  readonly link?: string;
}

/**
 * Stub validator functions
 */
export const validateProductList = (
  products: any[]
): Effect.Effect<ValidationResult, never, never> =>
  Effect.succeed({ isValid: true });

export const validatePaginationLinks = (
  links: any[]
): Effect.Effect<ValidationResult, never, never> =>
  Effect.succeed({ isValid: true });

export const validateProductData = (
  product: any
): Effect.Effect<ValidationResult, never, never> =>
  Effect.succeed({ isValid: true });

export const validateHTML = (
  html: string
): Effect.Effect<ValidationResult, never, never> =>
  Effect.succeed({ isValid: true });

export const validateExtractedData = (
  data: any
): Effect.Effect<ValidationResult, never, never> =>
  Effect.succeed({ isValid: true });
