import { Router } from 'express'
import { authenticate } from '../middleware/auth.middleware'
import {
    createDocumentVersionHandler,
    listDocumentVersionsHandler,
    restoreDocumentVersionHandler
} from '../controllers/documentVersion.controller'

const router = Router({ mergeParams: true })

router.use(authenticate)

router.get('/:docId/versions', listDocumentVersionsHandler)
router.post('/:docId/versions', createDocumentVersionHandler)
router.post('/:docId/versions/:versionId/restore', restoreDocumentVersionHandler)

export default router
