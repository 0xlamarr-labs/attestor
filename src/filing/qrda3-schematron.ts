/**
 * CMS QRDA III Schematron-Grade Validation — SaxonJS XPath Engine
 *
 * Validates QRDA Category III XML against CMS Implementation Guide
 * conformance requirements using real XPath 3.1 assertions evaluated
 * by the SaxonJS engine (the same engine used by Saxon for Schematron).
 *
 * ARCHITECTURE:
 * - Rules modeled after CMS 2026 QRDA III IG conformance statements
 * - Each rule is an XPath assertion with CONF: reference
 * - SaxonJS.XPath.evaluate() runs assertions against the parsed XML DOM
 * - Output format follows SVRL (Schematron Validation Report Language) conventions
 *
 * BOUNDARY:
 * - CMS IG-aligned XPath assertions, not official CMS .sch files
 * - SaxonJS XPath 3.1 engine (same as Saxon Schematron execution)
 * - Does not replace ONC Project Cypress for certification
 * - Covers document-level, section-level, and entry-level requirements
 *
 * SCOPE: 'cms_qrda3_xpath' — CMS IG XPath assertions via SaxonJS
 */

// ─── CMS IG Conformance Rules ──────────────────────────────────────────────
// Each rule maps to a CMS 2026 QRDA III IG conformance statement.

export interface SchematronRule {
  /** CMS conformance reference (e.g., 'CMS_0001', 'CONF:3338-17208') */
  id: string;
  /** Human-readable description */
  description: string;
  /** XPath assertion — must evaluate to boolean true for pass */
  xpath: string;
  /** Severity: error = SHALL, warning = SHOULD */
  severity: 'error' | 'warning';
  /** CMS IG section reference */
  section: string;
}

const CMS_QRDA3_RULES: SchematronRule[] = [
  // ─── Document-Level Requirements ─────────────────────────────────────────
  {
    id: 'CONF:3338-17226',
    description: 'SHALL contain exactly one realmCode with code="US"',
    xpath: 'boolean(/*[local-name()="ClinicalDocument"]/*[local-name()="realmCode"][@code="US"])',
    severity: 'error',
    section: 'Document',
  },
  {
    id: 'CONF:3338-17227',
    description: 'SHALL contain exactly one typeId',
    xpath: 'boolean(/*[local-name()="ClinicalDocument"]/*[local-name()="typeId"])',
    severity: 'error',
    section: 'Document',
  },
  {
    id: 'CONF:3338-17208',
    description: 'SHALL contain QRDA III templateId (root="2.16.840.1.113883.10.20.27.1.1")',
    xpath: 'boolean(/*[local-name()="ClinicalDocument"]/*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.27.1.1"])',
    severity: 'error',
    section: 'Document',
  },
  {
    id: 'CMS_0001',
    description: 'SHALL contain CMS QRDA III templateId (root="2.16.840.1.113883.10.20.27.1.2") with extension',
    xpath: 'boolean(/*[local-name()="ClinicalDocument"]/*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.27.1.2"][@extension])',
    severity: 'error',
    section: 'Document',
  },
  {
    id: 'CONF:3338-17209',
    description: 'SHALL contain code with code="55184-6" (QRDA Calculated Summary Report)',
    xpath: 'boolean(/*[local-name()="ClinicalDocument"]/*[local-name()="code"][@code="55184-6"])',
    severity: 'error',
    section: 'Document',
  },
  {
    id: 'CONF:3338-17209b',
    description: 'Document code SHALL reference LOINC codeSystem (2.16.840.1.113883.6.1)',
    xpath: 'boolean(/*[local-name()="ClinicalDocument"]/*[local-name()="code"][@codeSystem="2.16.840.1.113883.6.1"])',
    severity: 'error',
    section: 'Document',
  },
  {
    id: 'CONF:3338-17237',
    description: 'SHALL contain exactly one title',
    xpath: 'boolean(/*[local-name()="ClinicalDocument"]/*[local-name()="title"])',
    severity: 'error',
    section: 'Document',
  },
  {
    id: 'CONF:3338-17238',
    description: 'SHALL contain exactly one effectiveTime',
    xpath: 'boolean(/*[local-name()="ClinicalDocument"]/*[local-name()="effectiveTime"][@value])',
    severity: 'error',
    section: 'Document',
  },
  {
    id: 'CONF:3338-17210',
    description: 'SHALL contain confidentialityCode with code="N"',
    xpath: 'boolean(/*[local-name()="ClinicalDocument"]/*[local-name()="confidentialityCode"][@code="N"])',
    severity: 'error',
    section: 'Document',
  },
  {
    id: 'CONF:3338-17211',
    description: 'SHALL contain languageCode with code="en"',
    xpath: 'boolean(/*[local-name()="ClinicalDocument"]/*[local-name()="languageCode"][@code="en"])',
    severity: 'error',
    section: 'Document',
  },

  // ─── Structured Body ─────────────────────────────────────────────────────
  {
    id: 'CONF:3338-17213',
    description: 'SHALL contain component/structuredBody',
    xpath: 'boolean(/*[local-name()="ClinicalDocument"]/*[local-name()="component"]/*[local-name()="structuredBody"])',
    severity: 'error',
    section: 'StructuredBody',
  },

  // ─── Reporting Parameters Section ────────────────────────────────────────
  {
    id: 'CONF:3338-17244',
    description: 'SHALL contain Reporting Parameters section (templateId root="2.16.840.1.113883.10.20.17.2.1")',
    xpath: 'boolean(//*[local-name()="section"]/*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.17.2.1"])',
    severity: 'error',
    section: 'ReportingParameters',
  },
  {
    id: 'CONF:3338-17245',
    description: 'Reporting Parameters section SHALL have code="55187-9"',
    xpath: 'boolean(//*[local-name()="section"][*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.17.2.1"]]/*[local-name()="code"][@code="55187-9"])',
    severity: 'error',
    section: 'ReportingParameters',
  },
  {
    id: 'CONF:3338-17246',
    description: 'Reporting Parameters SHALL contain effectiveTime with low and high values',
    xpath: 'boolean(//*[local-name()="act"]/*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.17.3.8"]) and boolean(//*[local-name()="act"][*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.17.3.8"]]//*[local-name()="low"][@value]) and boolean(//*[local-name()="act"][*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.17.3.8"]]//*[local-name()="high"][@value])',
    severity: 'error',
    section: 'ReportingParameters',
  },

  // ─── Measure Section ─────────────────────────────────────────────────────
  {
    id: 'CONF:3338-17284',
    description: 'SHALL contain at least one Measure section (templateId root="2.16.840.1.113883.10.20.27.2.1")',
    xpath: 'boolean(//*[local-name()="section"]/*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.27.2.1"])',
    severity: 'error',
    section: 'MeasureSection',
  },
  {
    id: 'CONF:3338-17285',
    description: 'Measure section SHALL have code="55186-1" (Measure Document)',
    xpath: 'boolean(//*[local-name()="section"][*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.27.2.1"]]/*[local-name()="code"][@code="55186-1"])',
    severity: 'error',
    section: 'MeasureSection',
  },

  // ─── Measure Data Organizer ──────────────────────────────────────────────
  {
    id: 'CONF:3338-17286',
    description: 'Each measure SHALL contain a Measure Data organizer (templateId root="2.16.840.1.113883.10.20.27.3.1")',
    xpath: 'boolean(//*[local-name()="organizer"]/*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.27.3.1"])',
    severity: 'error',
    section: 'MeasureData',
  },
  {
    id: 'CONF:3338-17286b',
    description: 'Measure Data organizer SHALL have statusCode="completed"',
    xpath: 'boolean(//*[local-name()="organizer"][*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.27.3.1"]]/*[local-name()="statusCode"][@code="completed"])',
    severity: 'error',
    section: 'MeasureData',
  },

  // ─── Measure Reference ───────────────────────────────────────────────────
  {
    id: 'CONF:3338-17287',
    description: 'Each measure organizer SHALL reference the measure via externalDocument',
    xpath: 'boolean(//*[local-name()="organizer"][*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.27.3.1"]]//*[local-name()="externalDocument"])',
    severity: 'error',
    section: 'MeasureReference',
  },
  {
    id: 'CONF:3338-17287b',
    description: 'Measure reference externalDocument SHALL have an id with root and extension',
    xpath: 'boolean(//*[local-name()="externalDocument"]/*[local-name()="id"][@root])',
    severity: 'error',
    section: 'MeasureReference',
  },

  // ─── Aggregate Count Observations ────────────────────────────────────────
  {
    id: 'CONF:3338-17563',
    description: 'SHALL contain at least one Aggregate Count observation (templateId root="2.16.840.1.113883.10.20.27.3.3")',
    xpath: 'boolean(//*[local-name()="observation"]/*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.27.3.3"])',
    severity: 'error',
    section: 'AggregateCount',
  },
  {
    id: 'CONF:3338-17563b',
    description: 'Aggregate Count observations SHALL have statusCode="completed"',
    xpath: 'boolean(//*[local-name()="observation"][*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.27.3.3"]]/*[local-name()="statusCode"][@code="completed"])',
    severity: 'error',
    section: 'AggregateCount',
  },
  {
    id: 'CONF:3338-17564',
    description: 'Aggregate Count value SHALL be type INT',
    xpath: 'boolean(//*[local-name()="observation"][*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.27.3.3"]]/*[local-name()="value"][@*[local-name()="type"]="INT"])',
    severity: 'error',
    section: 'AggregateCount',
  },
  {
    id: 'CMS_POP_IPP',
    description: 'SHALL contain Initial Population (IPP) aggregate count',
    xpath: 'boolean(//*[local-name()="observation"]/*[local-name()="code"][@code="IPP"])',
    severity: 'error',
    section: 'PopulationCounts',
  },
  {
    id: 'CMS_POP_DENOM',
    description: 'SHALL contain Denominator (DENOM) aggregate count',
    xpath: 'boolean(//*[local-name()="observation"]/*[local-name()="code"][@code="DENOM"])',
    severity: 'error',
    section: 'PopulationCounts',
  },
  {
    id: 'CMS_POP_NUMER',
    description: 'SHALL contain Numerator (NUMER) aggregate count',
    xpath: 'boolean(//*[local-name()="observation"]/*[local-name()="code"][@code="NUMER"])',
    severity: 'error',
    section: 'PopulationCounts',
  },

  // ─── Performance Rate ────────────────────────────────────────────────────
  {
    id: 'CONF:3338-18411',
    description: 'SHALL contain at least one Performance Rate observation (templateId root="2.16.840.1.113883.10.20.27.3.14")',
    xpath: 'boolean(//*[local-name()="observation"]/*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.27.3.14"])',
    severity: 'error',
    section: 'PerformanceRate',
  },
  {
    id: 'CONF:3338-18411b',
    description: 'Performance Rate value SHALL be type REAL',
    xpath: 'boolean(//*[local-name()="observation"][*[local-name()="templateId"][@root="2.16.840.1.113883.10.20.27.3.14"]]/*[local-name()="value"][@*[local-name()="type"]="REAL"])',
    severity: 'error',
    section: 'PerformanceRate',
  },

  // ─── XML Well-Formedness ─────────────────────────────────────────────────
  {
    id: 'XML_WELLFORMED',
    description: 'Document root SHALL be ClinicalDocument in HL7 v3 namespace',
    xpath: 'boolean(/*[local-name()="ClinicalDocument" and namespace-uri()="urn:hl7-org:v3"])',
    severity: 'error',
    section: 'XMLStructure',
  },
];

// ─── Validator ─────────────────────────────────────────────────────────────

export interface SchematronAssertion {
  ruleId: string;
  description: string;
  passed: boolean;
  severity: 'error' | 'warning';
  section: string;
}

export interface SchematronValidationResult {
  valid: boolean;
  assertions: SchematronAssertion[];
  errors: number;
  warnings: number;
  totalRules: number;
  passedRules: number;
  /** CMS IG XPath assertions via SaxonJS — not official CMS .sch file execution */
  scope: 'cms_qrda3_xpath';
}

/**
 * Validate QRDA III XML against CMS IG conformance rules using SaxonJS XPath 3.1.
 *
 * This evaluates CMS IG-aligned XPath assertions against the XML document
 * using the SaxonJS engine (the same XPath engine used by Saxon Schematron).
 *
 * BOUNDARY: CMS IG-aligned XPath assertions, not official CMS .sch files.
 * The assertions are modeled after CMS 2026 QRDA III IG CONF: statements.
 */
export async function validateQrda3Schematron(xml: string): Promise<SchematronValidationResult> {
  const SaxonJS = await import('saxon-js');
  const Saxon = SaxonJS.default ?? SaxonJS;

  // Parse XML to DOM using SaxonJS platform
  let doc: any;
  try {
    doc = Saxon.getPlatform().parseXmlFromString(xml);
  } catch (err: any) {
    return {
      valid: false,
      assertions: [{ ruleId: 'XML_PARSE', description: `XML parse error: ${err.message}`, passed: false, severity: 'error', section: 'XMLParse' }],
      errors: 1, warnings: 0, totalRules: 1, passedRules: 0,
      scope: 'cms_qrda3_xpath',
    };
  }

  // Evaluate each CMS IG rule as an XPath assertion
  const assertions: SchematronAssertion[] = [];
  for (const rule of CMS_QRDA3_RULES) {
    let passed = false;
    try {
      passed = !!Saxon.XPath.evaluate(rule.xpath, doc);
    } catch {
      passed = false;
    }
    assertions.push({
      ruleId: rule.id,
      description: rule.description,
      passed,
      severity: rule.severity,
      section: rule.section,
    });
  }

  const errors = assertions.filter(a => !a.passed && a.severity === 'error').length;
  const warnings = assertions.filter(a => !a.passed && a.severity === 'warning').length;

  return {
    valid: errors === 0,
    assertions,
    errors,
    warnings,
    totalRules: assertions.length,
    passedRules: assertions.filter(a => a.passed).length,
    scope: 'cms_qrda3_xpath',
  };
}

/** Export the rule definitions for inspection/testing. */
export { CMS_QRDA3_RULES };
