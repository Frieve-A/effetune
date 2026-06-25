---
title: "Guide de Double Blind Test - EffeTune"
description: "Lancez des tests d'écoute à l'aveugle ABX et de préférence A/B entre deux pipelines d'effets dans EffeTune, puis vérifiez les résultats avec leur significativité statistique."
lang: fr
---

# Comment utiliser Double Blind Test

Double Blind Test vous permet de comparer à l'écoute **Pipeline A** et **Pipeline B** sans savoir lequel vous entendez. Cette fonction sert à vérifier sans biais si une différence que vous *pensez* entendre est réellement distinguable, et lequel des deux pipelines vous préférez vraiment.

Deux types de test sont disponibles :

- **ABX Test** : vérifie si vous pouvez distinguer les deux pipelines de façon fiable.
- **A/B Preference Test** : vous choisissez celui que vous préférez sans savoir lequel est lequel.

Dans les deux cas, EffeTune enregistre vos réponses et affiche une valeur p afin de déterminer si le résultat est statistiquement significatif.

## Préparer les deux pipelines

Le test compare les deux pipelines décrits dans [Utilisation des fonctions Pipeline AB](README.md#utilisation-des-fonctions-pipeline-ab) :

- **Pipeline A** et **Pipeline B** doivent contenir chacun au moins un effet.
- Placez l'un des réglages à comparer dans Pipeline A et l'autre dans Pipeline B. Gardez tout le reste identique sauf le point à tester, par exemple *Avec EQ* et *Sans EQ*, afin d'isoler cette seule différence.
- Pour un **A/B Preference Test**, peu importe lequel des deux réglages est placé dans Pipeline A ou dans Pipeline B. Pendant le test, le son présenté comme A ou comme B est choisi aléatoirement à chaque essai ; aucune position n'a donc d'avantage ou de désavantage. Si vous inversez les réglages, l'étiquette du pipeline gagnant affichée dans le résultat s'inverse aussi, mais l'interprétation statistique reste la même. Ce qui compte est de vous souvenir du réglage placé dans chaque pipeline : le résultat indique si Pipeline A ou Pipeline B a été préféré de façon significative, et vous devez le comparer à votre propre configuration pour savoir quel son vous avez préféré. Un résultat net signifie généralement que vous avez choisi de façon constante une différence qui compte réellement pour votre préférence. Si les deux sons paraissent identiques ou si vos choix varient, le test n'indiquera généralement pas de préférence significative.
- Vous pouvez ouvrir le panneau de test à tout moment, mais les boutons de démarrage restent désactivés tant que les deux pipelines ne sont pas présents. Si Pipeline B manque, un message l'indique.

## Ouvrir le test

- **Application web :** dans l'en-tête Effect Pipeline, cliquez sur le bouton **▼** situé juste à droite du bouton de basculement A/B, celui qui affiche "A" ou "B" selon le pipeline actuel, puis choisissez **Double Blind Test** dans le menu qui apparaît.
- **Application de bureau :** en plus du même menu **▼**, vous pouvez aussi ouvrir le test depuis **Fichier > Double Blind Test**.

Pendant que le test est ouvert, l'affichage de l'Effect Pipeline est masqué afin que vous ne puissiez pas voir quels effets sont actifs et que l'écoute reste aveugle. Vous pouvez fermer le test à tout moment avec le bouton **×** pour revenir à l'affichage normal.

## Configurer le test

L'écran de configuration propose les éléments suivants :

- **Test name:** décrit la différence testée, par exemple *Avec EQ vs. Sans EQ*. Le sélecteur fonctionne comme Effect Presets : vous pouvez enregistrer, rappeler et supprimer des tests nommés. Un test enregistré contient les deux pipelines et le nombre d'essais, ce qui permet de recharger plus tard la même comparaison. Un nom de test est nécessaire pour pouvoir partager le test.
- **Your name:** facultatif. Il apparaît dans le résultat. Si le champ est vide, le résultat utilise *Anonymous*.
- **Number of tests:** nombre d'essais à exécuter, défini avec le champ de saisie ou le curseur. Plus il y a d'essais, plus le résultat est fiable, mais plus le test prend du temps. La valeur par défaut est 20.

Appuyez sur **Start ABX Test** ou **Start A/B Preference Test** pour commencer.

> **Remarque :** les lettres **A** et **B** dans le test sont distinctes de Pipeline A et Pipeline B dans l'Effect Pipeline. À chaque essai, EffeTune décide de nouveau au hasard quel pipeline est attribué à A et lequel est attribué à B, et cette correspondance n'est jamais affichée. Vous ne pouvez donc pas savoir quel pipeline réel vous entendez actuellement comme A, ni supposer que "A" signifie Pipeline A. C'est ce qui maintient le test en aveugle.

## Lire l'audio

Le test ne fait que changer de pipeline ; vous fournissez la musique comme d'habitude :

- glissez-déposez un fichier musical, ou ouvrez-le depuis le menu Fichier, ou
- envoyez de l'audio vers EffeTune depuis une source physique.

La fréquence d'échantillonnage du périphérique audio est affichée sur l'écran du test à titre de référence.

## Réaliser un ABX Test

1. Utilisez les boutons **Switch to A**, **Switch to B** et **Switch to X** pour changer l'audio en cours de lecture entre les échantillons. **X** est identique à A ou à B, avec un choix aléatoire à chaque essai.
2. Passez d'un échantillon à l'autre autant de fois que nécessaire jusqu'à déterminer lequel correspond à **X**.
3. Cliquez sur **X matches A** ou **X matches B** pour enregistrer votre réponse et passer à l'essai suivant.

Vous pouvez aussi changer d'échantillon au clavier : appuyez sur **A**, **B** ou **X**, ou sur **1**, **2** ou **3** sur la rangée supérieure ou le pavé numérique, pour activer l'échantillon correspondant comme avec le bouton. Pour voter, appuyez sur **Q** pour **X matches A** ou sur **W** pour **X matches B**.

## Réaliser un A/B Preference Test

1. Utilisez **Switch to A** et **Switch to B** pour comparer les deux sons. Il n'y a pas de X dans ce mode.
2. Lorsque vous avez décidé lequel vous préférez, cliquez sur **Prefer A** ou **Prefer B**.

Vous pouvez aussi changer d'échantillon au clavier : appuyez sur **A** ou **B**, ou sur **1** ou **2** sur la rangée supérieure ou le pavé numérique, pour changer l'échantillon actif. Pour voter, appuyez sur **Q** pour **Prefer A** ou sur **W** pour **Prefer B**.

## Lire le résultat

Lorsque tous les essais sont terminés, EffeTune affiche le résultat :

- **ABX Test :** le taux de réponses correctes, le nombre de réponses correctes sur le total et la valeur p d'un test binomial unilatéral sont affichés. Si **p < 0.05**, le résultat est statistiquement significatif : vos réponses sont donc difficiles à expliquer par le seul hasard, et l'on peut dire que vous avez pu distinguer les deux pipelines. Sinon, on ne peut pas dire que vous les avez distingués.
- **A/B Preference Test :** le pipeline choisi le plus souvent, affiché comme Pipeline A en cas d'égalité, son nombre de choix sous forme de compte sur le total, ainsi que la valeur p d'un test binomial bilatéral sont affichés. Le pourcentage affiché correspond toujours au côté gagnant ; il est donc toujours d'au moins 50 %, et un pourcentage élevé ne signifie pas à lui seul qu'il existe une préférence réelle. La décision se fait avec la valeur p : si **p < 0.05**, votre préférence est significative. Sinon, on ne peut pas dire qu'il y ait eu une préférence significative ; un résultat proche de 50 % relève du hasard attendu.

Le temps total passé à effectuer le test est également affiché.

## Partager un test

Cliquez sur **Share this test** pour copier une URL dans le presse-papiers. Cette URL reproduit **les deux pipelines d'effets et ouvre le test à l'aveugle**, afin que la personne qui la reçoit puisse lancer la même comparaison de pipelines. Vous pouvez partager depuis l'écran de configuration avant de commencer, ou après avoir terminé. Si vous partagez avant de commencer, l'élément principal partagé est la comparaison entre les deux pipelines ; vérifiez le nombre d'essais avant de lancer le test. Si vous partagez après avoir terminé, votre résultat est également inclus, et la personne qui reçoit l'URL peut le consulter avant d'essayer elle-même la même comparaison.

Le partage nécessite les deux pipelines et un nom de test. Cela garantit que la comparaison partagée a un sens et peut être reproduite chez l'autre personne.

Utiliser une URL de test partagée :

- **Application web :** ouvrez l'URL partagée dans un navigateur. EffeTune restaure les deux pipelines et ouvre Double Blind Test automatiquement.
- **Application de bureau :** copiez l'URL partagée, basculez vers EffeTune, puis collez-la avec **Édition > Coller**, **Ctrl+V** ou **Command+V** sur macOS, ou avec le bouton **Coller les effets** de la barre d'outils. EffeTune lit l'URL depuis le presse-papiers, restaure les deux pipelines et ouvre Double Blind Test. Collez l'URL lorsque le panneau Double Blind Test n'est pas déjà ouvert.

[← Retour au README](README.md)
