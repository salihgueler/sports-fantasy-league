/**
 * @fantasy/draft — Draft Service public API.
 */
export { DraftService } from './draft-service.js';
export { handler } from './handler.js';
export type {
  SubmitSquadInput,
  SubmitSquadResult,
  PlayerFilters,
  SetFormationInput,
} from './draft-service.js';
export { validateSquad } from './squad-validator.js';
export type { ValidationResult, ValidationError } from './squad-validator.js';
export { validateFormation } from './formation-validator.js';
export type { FormationValidationResult, FormationValidationError } from './formation-validator.js';
