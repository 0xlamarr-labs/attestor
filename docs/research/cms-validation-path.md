# Research: CMS QRDA III Validation Path

*Captured: April 2026*

## What "CMS-certified" means
- XML passes CMS Schematron validation rules (published annually)
- CDA Release 2 Schema validation
- Cypress CVU+ validation (ONC's official testing tool)
- You cannot self-certify — ONC Cypress program required
- Honest claim: "generates CMS-validatable QRDA III" (if Schematron passes)

## Validation approach
- npm package: `cda-schematron` (ISO Schematron for CDA documents)
- Download CMS 2026 Schematron .sch files from ecqi.healthit.gov
- Place in schemas/cms-qrda3-2026/
- Run validation: zero errors = CMS-validatable

## Cypress (ONC tool)
- Ruby on Rails application, NOT callable from Node.js as library
- Docker: `docker pull quay.io/projectcypress/cypress`
- Schematron validation is what Cypress uses internally
- cda-schematron in Node.js is the practical path

## Key template IDs (OIDs)
- Root: 2.16.840.1.113883.10.20.27.1.1 (QRDA Cat III Report)
- CMS extension: 2.16.840.1.113883.10.20.27.1.2
- Measure section: 2.16.840.1.113883.10.20.27.2.1
- Performance rate: 2.16.840.1.113883.10.20.27.3.14
- Aggregate count: 2.16.840.1.113883.10.20.27.3.3

## Effort
- 2-4 weeks for full CMS-compliant generator
- Schematron validation wrapper: 0.5 day
- Currently: QRDA III generator exists, not validated
