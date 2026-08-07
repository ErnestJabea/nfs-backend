"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
router.get('/unread-count', (_req, res) => {
    return res.json({ unread: 0 });
});
router.get('/', (_req, res) => {
    return res.json({ data: [], unread: 0, total: 0 });
});
router.patch('/read-all', (_req, res) => {
    return res.json({ message: 'Toutes les notifications ont été marquées comme lues.' });
});
router.patch('/:id/read', (_req, res) => {
    return res.json({ message: 'Notification marquée comme lue.' });
});
router.get('/push/public-key', (_req, res) => {
    return res.json({ publicKey: '' });
});
router.post('/push/subscriptions', (_req, res) => {
    return res.json({ message: 'Abonnement push enregistré.' });
});
router.delete('/push/subscriptions', (_req, res) => {
    return res.json({ message: 'Abonnement push supprimé.' });
});
exports.default = router;
