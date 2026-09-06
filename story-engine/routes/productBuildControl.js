import { json } from '../lib/miniRouter.js';
import { requireFounderControlRoomController } from '../lib/internalControl.js';
import { executeProductBuildDirective } from '../lib/productBuildControl.js';

export default function productBuildControlRoutes(router, db) {
  router.post('/api/control-room/product-build/execute', (req, res) => {
    if (!requireFounderControlRoomController(req, res)) return;

    try {
      const receipt = executeProductBuildDirective(db, req.body || {});
      json(res, 200, {
        receipt,
        authority: {
          product_control_room: 'storyengine-control-room',
          caller_tenant: 'founder-control-room',
          execution_authorized_by_directive: true,
          merge_authorized: false,
          deploy_authorized: false,
          provider_mutation_authorized: false,
          external_proof_still_required: true,
        },
      });
    } catch (error) {
      json(res, 400, {
        error: 'invalid_product_build_directive',
        message: error instanceof Error ? error.message : 'Product build directive rejected.',
        request_id: req.request_id,
      });
    }
  });
}
