# Paiements externes NFS

Cette intégration permet d'approvisionner un compte NFS après une autorisation OTP NFS, puis une authentification propre au prestataire. Le retour du navigateur n'est jamais considéré comme une preuve de paiement.

## Prestataires

- Flutterwave : carte, Orange Money et MTN MoMo en XAF.
- Stripe Checkout : carte uniquement, après validation contractuelle de l'activité financière NFS.

Les pages carte sont hébergées par le prestataire. NFS ne reçoit ni numéro de carte, ni CVV, ni PIN Mobile Money, ni OTP 3-D Secure.

## Configuration sandbox

Copier les variables de `.env.example` vers le gestionnaire de secrets du serveur :

```dotenv
PAYMENTS_ENVIRONMENT=sandbox
PAYMENTS_REQUIRE_APPROVED_KYC=false
PAYMENT_MIN_AMOUNT_XAF=100
PAYMENT_MAX_AMOUNT_XAF=5000000
PAYMENT_RETURN_URL=http://localhost:5173/funding

FLW_PAYMENTS_ENABLED=true
FLW_SECRET_KEY=FLWSECK_TEST_...
FLW_SECRET_HASH=...

STRIPE_PAYMENTS_ENABLED=true
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Ne jamais committer ces valeurs. Les clés publiques ne sont pas nécessaires dans la PWA pour les checkouts hébergés.

## Webhooks

Configurer dans les tableaux de bord :

- Flutterwave : `https://API_NFS/api/payments/webhooks/flutterwave`
- Stripe : `https://API_NFS/api/payments/webhooks/stripe`

En local, Stripe CLI peut transmettre les événements avec :

```text
stripe listen --forward-to localhost:5000/api/payments/webhooks/stripe
```

Le secret `whsec_...` affiché par la CLI doit être placé dans `STRIPE_WEBHOOK_SECRET` uniquement pour la session de test locale.

## Déploiement de la base

Après sauvegarde de la base de test :

```text
npx prisma db push
```

Les nouvelles collections sont `external_payments`, `payment_events` et `ledger_entries`.

## Garanties appliquées

1. OTP transactionnel NFS obligatoire avant la création du checkout.
2. Montants XAF entiers et bornés côté serveur.
3. Référence unique et idempotence prestataire.
4. Signature vérifiée sur le corps webhook brut.
5. Nouvelle lecture de la transaction auprès du prestataire.
6. Comparaison exacte du prestataire, de la référence, du montant et de la devise.
7. Crédit atomique unique avec deux écritures de journal équilibrées.
8. Événements webhook dédupliqués.
9. Toute incohérence passe en `REVIEW_REQUIRED` sans crédit automatique.
10. Rapprochement automatique toutes les cinq minutes pour les notifications retardées ou perdues.
11. Les remboursements et litiges signalés placent le paiement en revue et bloquent le montant encore disponible.

Les paiements et anomalies sont consultables par les administrateurs via `GET /api/payments/admin` avec les filtres `status`, `provider`, `page` et `limit`.

## Activation production

L'application refuse de démarrer avec des paiements actifs si l'URL de retour n'est pas en HTTPS, si `PAYMENTS_ENVIRONMENT` n'est pas `production`, ou si une clé Stripe/Flutterwave de test est utilisée. Il faut également activer `PAYMENTS_REQUIRE_APPROVED_KYC=true`, enregistrer les webhooks de production et obtenir l'accord écrit des prestataires pour le modèle financier NFS.
