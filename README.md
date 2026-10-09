# junior-entreprise-manager

Site de campagne de la liste **Leclercq des étoiles** (HEC Paris), thème « guerre des étoiles » (bleu et or), avec une face pour les étudiants et un espace de gestion pour la liste.

Site statique : aucun serveur ni installation. Ouvrez `index.html` dans un navigateur, ou publiez le dépôt avec GitHub Pages (Settings → Pages → Deploy from a branch → `main` / `(root)`).
Adresse une fois publiée : https://margauxbouriez-a11y.github.io/junior-entreprise-manager/

## Fichiers
- `data.js` — le contenu du site. Il est mis à jour automatiquement depuis l'Espace liste (voir plus bas). La partie publique (programme, food, équipe…) est lisible ; la partie privée (budget, stocks, abonnés) est chiffrée.
- `index.html` — la mise en page et les textes fixes.
- `app.js` — le fonctionnement.

## Face étudiants
- **Accueil** : le logo et le message de la campagne, puis « Comment ça marche » : les 4 usages du site (Programme, Food, Boutique, Équipe) avec une info en direct pour chacun.
- Le logo est dans `assets/` (`logo.jpg`, `logo-180.png`, `favicon.png`) : remplacez ces fichiers pour le changer.
- **Programme** : les 2 semaines de campagne jour par jour (événements + stands food).
- **Food** : chaque stand avec la date, le lieu, le prix et une jauge des portions restantes.
- **Services** proposés par la liste.
- **Où sommes-nous ?** : la position et le statut de chaque membre, avec un bouton pour l'appeler.
- **Inscription e-mail** pour recevoir le programme.

## Espace liste (bouton « Espace liste », ou `#liste` à la fin de l'adresse)
Code d'accès par défaut : `leclercq2026` (modifiable dans Réglages). Il chiffre aussi les données privées.
- **Aperçu** (page d'accueil de l'espace) : les stocks food à surveiller avec boutons +/−, la position et le statut de chaque membre (modifiables directement), et les stands food du jour avec le compteur de portions servies.
- **Stocks food** : un produit par carte, rangé par catégorie (Food, Boissons, Matériel…), avec boutons +/−, seuil d'alerte, filtre « À racheter » et liste de courses générée.
- **Où sont les membres** : une carte par membre ; un clic pour changer de statut (Disponible, Occupé·e, En pause, Absent·e), un champ pour la position (avec suggestions des lieux connus), et l'heure de la dernière mise à jour.
- **Budget** : recettes et dépenses, solde, plafond, dépenses par poste.
- **Boutique** : catalogue des articles offerts, limite par commande, disponibilité, ouverture ou fermeture de la boutique.
- **Stands food**, **E-mails**, **Événements et services**, **Réglages**.

## Publier les modifications (publication automatique)
Depuis l'Espace liste, chaque modification (événements, stands food, membres, stocks, budget…) peut être **mise en ligne automatiquement** pour tout le monde, en une minute environ. Les écrans publics déjà ouverts se mettent à jour tout seuls toutes les 90 secondes.

**À faire une fois :**
1. Sur GitHub : **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - *Repository access* : **Only select repositories** → `junior-entreprise-manager`.
   - *Permissions → Repository permissions* : **Contents → Read and write**.
   - *Expiration* : la fin de la campagne.
2. Copiez la clé (`github_pat_…`).
3. Sur le site : **Espace liste → Réglages → Publication automatique**, collez la clé, puis **Activer sur cet appareil**.
4. Chaque membre fait l'étape 3 sur son téléphone ou son ordinateur. Partagez la clé uniquement en privé : elle permet de modifier les fichiers de ce dépôt. Si elle fuit, supprimez-la sur GitHub et créez-en une autre.

Si deux membres modifient en même temps, leurs changements sont fusionnés automatiquement.
Sans clé, les modifications restent sur l'appareil ; le bouton **Exporter data.js** permet alors de publier à la main (remplacer `data.js` sur GitHub).

**Données privées :** dans `data.js`, le budget, les stocks, les abonnés et les campagnes e-mail sont **chiffrés avec le code d'accès** de l'Espace liste (`leclercq2026` par défaut, à changer dans Réglages, 8 caractères minimum). Sans le code, ces données sont illisibles, même en ouvrant le fichier. Si vous changez le code, prévenez tous les membres. Si vous le perdez, la partie privée est perdue.

## Boutique : commandes offertes (boissons, crêpes, ménage…) via n8n
Dans la section **Commander**, les étudiants ajoutent des articles à leur commande, en respectant une limite par article (par exemple 2 Red Bull au maximum), puis indiquent où les livrer et valident. **Tout est offert, il n'y a aucun paiement.** Chaque commande reçoit un numéro (`LQ-1015-4821`) et part vers un webhook n8n, qui :
- envoie un mail à la liste avec le détail. Pour écrire à l'étudiant, il suffit de répondre à ce mail ;
- envoie un récapitulatif à l'étudiant.

**Gérer le catalogue :** Espace liste → onglet **Boutique**. On peut y ajouter, modifier ou supprimer des produits, régler le maximum par commande, et décocher « Dispo » quand un produit est épuisé. On peut aussi ouvrir ou fermer toute la boutique.

**Brancher n8n :**
1. Dans n8n : **Create workflow → ⋯ → Import from File**, puis choisissez `n8n/commandes-workflow.json`.
2. Dans **Mail à la liste** et **Récapitulatif à l'étudiant**, choisissez votre compte Gmail. Remplacez `ADRESSE-DE-LA-LISTE@gmail.com` par les adresses qui doivent recevoir les commandes (plusieurs possibles, séparées par des virgules, adresses HEC comprises).
3. **Save**, puis **Publish**. Copiez la **Production URL** du nœud « Commande reçue ».
4. Sur le site : **Espace liste → Boutique → Webhook des commandes**, collez l'URL, puis **Enregistrer**.

Tant qu'aucun webhook n'est réglé, la commande ouvre la messagerie de l'étudiant vers l'e-mail de contact de la liste. Sans e-mail de contact non plus, le site indique que les commandes ne sont pas encore ouvertes.

## Inscriptions e-mail
Pour recevoir les inscriptions des étudiants de tous les appareils, renseignez dans **Réglages** l'URL d'un webhook (n8n, Zapier, Google Apps Script…). La plateforme y envoie `{ email, name, date, list }` en JSON.

> Ce qui est dans la partie publique de `data.js` (événements, stands, membres et leurs téléphones…) est visible par tout le monde. Ne mettez que des informations que vous acceptez de rendre publiques.
