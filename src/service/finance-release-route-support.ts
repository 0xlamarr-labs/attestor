import { review, verification } from '../release-layer/index.js';
import {
  action as financeActionRelease,
  communication as financeCommunicationRelease,
  record as financeRecordRelease,
} from '../release-layer/finance.js';

export const {
  buildFinanceCommunicationReleaseMaterial,
  buildFinanceCommunicationReleaseObservation,
  createFinanceCommunicationReleaseCandidateFromReport,
} = financeCommunicationRelease;

export const {
  buildFinanceActionReleaseMaterial,
  buildFinanceActionReleaseObservation,
  createFinanceActionReleaseCandidateFromReport,
} = financeActionRelease;

export const {
  buildFinanceFilingReleaseMaterial,
  createFinanceFilingReleaseCandidateFromReport,
  FINANCE_FILING_ADAPTER_ID,
  finalizeFinanceFilingReleaseDecision,
  buildFinanceFilingReleaseObservation,
} = financeRecordRelease;

export const { createFinanceReviewerQueueItem } = review;

export const {
  ReleaseVerificationError,
  resolveReleaseTokenFromRequest,
  verifyReleaseAuthorization,
} = verification;
