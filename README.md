# junior-entreprise-manager

Site de campagne de la liste **Leclercq** (HEC Paris), avec une face pour les étudiants et un espace de gestion pour la liste.

Site statique : aucun serveur ni installation. Ouvrez `index.html` dans un navigateur, ou publiez le dépôt avec GitHub Pages (Settings → Pages → Deploy from a branch → `main` / `(root)`).
Adresse une fois publiée : https://margauxbouriez-a11y.github.io/junior-entreprise-manager/

## Fichiers
- `data.js` — le contenu : nom de la liste, membres, événements, stands, budget, stocks… **C'est le fichier à modifier.**
- `index.html` — la mise en page et les textes fixes.
- `app.js` — le fonctionnement.

## Face étudiants
- **Programme** : les 2 semaines de campagne jour par jour (événements + stands food).
- **Food** : chaque stand avec la date, le lieu, le prix et une jauge des portions restantes.
- **Services** proposés par la liste.
- **Où sommes-nous ?** : la position et le statut de chaque membre, avec un bouton pour l'appeler.
- **Inscription e-mail** pour recevoir le programme.

## Espace liste (bouton « Espace liste », ou `#liste` à la fin de l'adresse)
Code d'accès par défaut : `leclercq2026` (modifiable dans Réglages).
- **Budget** : recettes et dépenses, solde, plafond, dépenses par poste.
- **Stocks** : quantités avec boutons +/−, seuils d'alerte, liste de courses générée.
- **E-mails** : abonnés (copie et export CSV), brouillons de campagne, insertion du programme du jour, ouverture dans la messagerie avec les destinataires en Cci.
- **Stands food** : portions prévues et servies (la jauge publique suit).
- **Événements et services**, **Membres** (position et statut), **Réglages**.

## Publier les modifications
Le site n'a pas de base de données. Ce que la liste modifie est enregistré dans le navigateur utilisé.
Pour que tous les étudiants voient les changements : **Espace liste → Exporter data.js**, puis remplacez `data.js` dans le dépôt (sur GitHub : *Add file → Upload files*).

## Inscriptions e-mail
Pour recevoir les inscriptions des étudiants de tous les appareils, renseignez dans **Réglages** l'URL d'un webhook (n8n, Zapier, Google Apps Script…). La plateforme y envoie `{ email, name, date, list }` en JSON.

> Le code d'accès est vérifié dans le navigateur. Il évite les modifications par erreur, mais ce n'est pas une vraie sécurité. Ne mettez pas de données sensibles dans `data.js`, car il est public.
