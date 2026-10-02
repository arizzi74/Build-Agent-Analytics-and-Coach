/**
 * Bonifica integrazione GitHub AutoGen — Fase 2 (vedi docs/scope-cleanup-plan.md §7).
 *
 * I due provider OAuth qui sotto erano posseduti dall'applicazione
 * (sys_package = x_snc_build_agranx) ma NON erano presenti nel sorgente Fluent,
 * quindi la semplice rimozione dei file generati non li avrebbe eliminati.
 *
 * Sono i duplicati generati automaticamente dal wizard di connessione il
 * 15 settembre 2026 a 14 secondi di distanza, entrambi riferiti alla stessa
 * registrazione GitHub (client_id Ov23liUBrkMZumNNiU25). Nessun codice
 * dell'applicazione li utilizza: verificato con ricerca su `github`,
 * `RESTMessage`, `sn_ws` e `getProperty` (zero riscontri nel codice).
 *
 * NON riguarda il footprint GitHub dell'MCP Server in scope Global
 * (AutoGen-GitHub-1787823382147), che resta intatto.
 */

// AutoGen-GitHub-1789458559154-OAuthProvider
Now.del('oauth_entity', '74ca09da2f9f4350cebb654fafa4e30e')

// AutoGen-GitHub-1789458573269-OAuthProvider
Now.del('oauth_entity', '44da09da2f9f4350cebb654fafa4e3ab')
