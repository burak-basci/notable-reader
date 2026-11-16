// Compatibility worker entry. Canonical service-worker imports the same handoff module.
import {installArticleHandoff} from './article-handoff.mjs';
installArticleHandoff();
