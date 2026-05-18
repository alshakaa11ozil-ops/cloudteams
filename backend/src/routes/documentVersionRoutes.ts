import { Router } from 'express'
import {
    createDocumentVersionHandler,
    listDocumentVersionsHandler,
    restoreDocumentVersionHandler
} from '../controllers/documentVersion.controller'

// NOTE: This router is mounted via router.use('/', documentVersionRoutes) inside
// documentRoutes.ts which is already scoped to /:docId (mergeParams: true).
// So these routes resolve as:
//   GET  /api/teams/:teamId/documents/:docId/versions
//   POST /api/teams/:teamId/documents/:docId/versions
//   POST /api/teams/:teamId/documents/:docId/versions/:versionId/restore
const router = Router({ mergeParams: true })

router.get('/versions', listDocumentVersionsHandler)
router.post('/versions', createDocumentVersionHandler)
router.post('/versions/:versionId/restore', restoreDocumentVersionHandler)

export default router
