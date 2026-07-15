import { WebSqliteCatalogRepository } from '../../js/library/repository/web-catalog-repository.js';
import { installWebCatalogWorker } from '../../js/library/repository/web-catalog-worker.js';
import { createReferenceFixtureLoader } from './reference-fixture.mjs';

const repository = new WebSqliteCatalogRepository({ authority: 'worker' });

installWebCatalogWorker(globalThis, {
  repository,
  referenceFixtureLoader: createReferenceFixtureLoader(repository)
});
