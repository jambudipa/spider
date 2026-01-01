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
  _products: ProductData[]
): Effect.Effect<ValidationResult> =>
  Effect.succeed({ isValid: true });

export const validatePaginationLinks = (
  _links: string[]
): Effect.Effect<ValidationResult> =>
  Effect.succeed({ isValid: true });

export const validateProductData = (
  _product: ProductData
): Effect.Effect<ValidationResult> =>
  Effect.succeed({ isValid: true });

export const validateHTML = (
  _html: string
): Effect.Effect<ValidationResult> =>
  Effect.succeed({ isValid: true });

export const validateExtractedData = (
  _data: Record<string, unknown>
): Effect.Effect<ValidationResult> =>
  Effect.succeed({ isValid: true });
