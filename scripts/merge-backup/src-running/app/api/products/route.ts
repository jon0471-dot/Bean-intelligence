import { handle, ok } from '@/lib/api/errors'
import { BEAN_PRODUCTS } from '@/lib/registry/products'
import { getBackendsForProduct } from '@/lib/registry/backends'
import { LAXII_SIZES } from '@/lib/registry/products'

/**
 * Capability discovery — the ONLY catalog the customer UI may render.
 * It exposes BEAN product identity and real availability flags; upstream
 * model identities stay in the private registry (admin-only surface).
 */
export async function GET() {
  return handle(async () => {
    const products = BEAN_PRODUCTS.map((p) => {
      const enabled = getBackendsForProduct(p.id).some((b) => b.enabled)
      return {
        id: p.id,
        name: p.name,
        tagline: p.tagline,
        description: p.description,
        task: p.task,
        accent: p.accent,
        icon: p.icon,
        available: enabled,
      }
    })
    return ok({ products, laxiiSizes: LAXII_SIZES })
  })
}
