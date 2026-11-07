/**
 * BEAN Intelligence — error mapping shared by engine worker handlers.
 *
 * Translates typed upstream/Bean errors into the engine's honest failure
 * classification. Rate limiting is its own class and is NEVER retried by
 * the queue (429 protocol: a throttled account is not hammered — the job
 * fails with its real cause and the UI says so).
 */

import { BeanApiError } from '@/lib/api/errors'
import { classifyUpstreamError } from '@/lib/upstream/gateway'
import {
  UpstreamRateLimitError,
  UpstreamAuthError,
  UpstreamBillingError,
} from '@/lib/upstream/gateway'
import { UpstreamTruncatedError } from '@/lib/adapters/hosted-llm'
import type { JobErrorClass } from './types'

export interface ClassifiedFailure {
  errorClass: JobErrorClass
  errorCode: string
  errorMessage: string
}

export function classifyJobFailure(e: unknown): ClassifiedFailure {
  if (e instanceof BeanApiError) {
    const code = e.code
    if (code === 'RATE_LIMITED') {
      return { errorClass: 'rate_limited', errorCode: code, errorMessage: e.message }
    }
    if (code === 'QUOTA_EXCEEDED') return { errorClass: 'permanent', errorCode: code, errorMessage: e.message }
    if (code === 'COST_LIMIT') return { errorClass: 'budget', errorCode: code, errorMessage: e.message }
    if (code === 'PRODUCT_UNAVAILABLE' || code === 'NO_BACKEND' || code === 'CAPABILITY_UNSUPPORTED') {
      return { errorClass: 'permanent', errorCode: code, errorMessage: e.message }
    }
    if (code === 'CONCURRENCY_LIMIT') {
      return { errorClass: 'permanent', errorCode: code, errorMessage: e.message }
    }
    return { errorClass: 'permanent', errorCode: code, errorMessage: e.message }
  }
  if (e instanceof UpstreamRateLimitError) {
    return { errorClass: 'rate_limited', errorCode: 'UPSTREAM_RATE_LIMITED', errorMessage: e.message }
  }
  if (e instanceof UpstreamAuthError) {
    return { errorClass: 'auth', errorCode: 'UPSTREAM_AUTH', errorMessage: e.message }
  }
  if (e instanceof UpstreamBillingError) {
    return { errorClass: 'billing', errorCode: 'UPSTREAM_BILLING', errorMessage: e.message }
  }
  if (e instanceof UpstreamTruncatedError) {
    return {
      errorClass: 'permanent',
      errorCode: 'UPSTREAM_TRUNCATED',
      errorMessage: 'The provider cut the response at its output limit.',
    }
  }
  const failure = classifyUpstreamError(e)
  switch (failure.kind) {
    case 'rate_limited':
      return { errorClass: 'rate_limited', errorCode: 'UPSTREAM_RATE_LIMITED', errorMessage: 'The AI provider is rate limiting this account. The request was not repeated.' }
    case 'auth':
      return { errorClass: 'auth', errorCode: 'UPSTREAM_AUTH', errorMessage: 'The provider rejected the credentials for this request.' }
    case 'billing':
      return { errorClass: 'billing', errorCode: 'UPSTREAM_BILLING', errorMessage: 'The provider account cannot cover this request.' }
    case 'timeout':
      return { errorClass: 'timeout', errorCode: 'BACKEND_TIMEOUT', errorMessage: 'The provider did not respond in time.' }
    case 'network':
      return { errorClass: 'network', errorCode: 'UPSTREAM_NETWORK', errorMessage: 'The connection to the provider failed.' }
    default:
      return {
        errorClass: 'unknown',
        errorCode: 'BACKEND_FAILURE',
        errorMessage: e instanceof Error ? e.message : 'The backend call failed.',
      }
  }
}
