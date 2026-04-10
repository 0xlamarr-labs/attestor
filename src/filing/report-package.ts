import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { create } from 'xmlbuilder2';
import type { FilingIssuedPackage, FilingIssuedPackageFile, FilingPackage } from './filing-adapter.js';

const REPORT_PACKAGE_DOCUMENT_TYPES = {
  nonInline: 'https://xbrl.org/report-package/2023/xbr',
  unconstrained: 'https://xbrl.org/report-package/2023',
} as const;

const XBRL_CSV_DOCUMENT_TYPE = 'https://xbrl.org/2021/xbrl-csv';

const XBRL_NAMESPACES: Record<string, string> = {
  xbrli: 'http://www.xbrl.org/2003/instance',
  link: 'http://www.xbrl.org/2003/linkbase',
  xlink: 'http://www.w3.org/1999/xlink',
  iso4217: 'http://www.xbrl.org/2003/iso4217',
  us_gaap: 'http://fasb.org/us-gaap/2024-01-31',
  dei: 'http://xbrl.sec.gov/dei/2024',
  attestor: 'https://attestor.dev/xbrl/2026/attestor',
  eba_met: 'https://www.eba.europa.eu/xbrl/2024/met',
  eba_dim: 'https://www.eba.europa.eu/xbrl/2024/dim',
};

export async function issueFilingPackage(pkg: FilingPackage): Promise<FilingIssuedPackage> {
  const topLevelDirectory = buildTopLevelDirectory(pkg);
  const reportFileName = buildReportFileName(pkg);
  const reportPath = `${topLevelDirectory}/reports/${reportFileName}`;
  const metadataPath = `${topLevelDirectory}/META-INF/reportPackage.json`;
  const supportManifestPath = `${topLevelDirectory}/attestor/package-manifest.json`;
  const evidencePath = `${topLevelDirectory}/attestor/evidence-link.json`;
  const packageType = 'non-inline-xbrl' as const;
  const fileExtension = '.xbr' as const;

  const zip = new JSZip();

  const reportPackageJson = JSON.stringify({
    documentInfo: {
      documentType: REPORT_PACKAGE_DOCUMENT_TYPES.nonInline,
    },
  }, null, 2);

  zip.file(metadataPath, reportPackageJson);

  const reportContent = renderReportContent(pkg);
  zip.file(reportPath, reportContent.text);

  const supportManifest = JSON.stringify({
    adapterId: pkg.adapterId,
    format: pkg.format,
    generatedAt: pkg.generatedAt,
    validation: pkg.validation,
    reportPath: reportPath.slice(topLevelDirectory.length + 1),
    reportMediaType: reportContent.mediaType,
  }, null, 2);
  zip.file(supportManifestPath, supportManifest);

  const evidenceLink = JSON.stringify(pkg.evidenceLink, null, 2);
  zip.file(evidencePath, evidenceLink);

  for (const extra of reportContent.additionalFiles) {
    zip.file(`${topLevelDirectory}/${extra.path}`, extra.text);
  }

  const archiveBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  const files: FilingIssuedPackageFile[] = [
    fileDescriptor(metadataPath.slice(topLevelDirectory.length + 1), 'application/json', Buffer.from(reportPackageJson, 'utf8')),
    fileDescriptor(reportPath.slice(topLevelDirectory.length + 1), reportContent.mediaType, Buffer.from(reportContent.text, 'utf8')),
    fileDescriptor(supportManifestPath.slice(topLevelDirectory.length + 1), 'application/json', Buffer.from(supportManifest, 'utf8')),
    fileDescriptor(evidencePath.slice(topLevelDirectory.length + 1), 'application/json', Buffer.from(evidenceLink, 'utf8')),
    ...reportContent.additionalFiles.map((extra) =>
      fileDescriptor(extra.path, extra.mediaType, Buffer.from(extra.text, 'utf8')),
    ),
  ];

  return {
    packageType,
    fileExtension,
    documentType: REPORT_PACKAGE_DOCUMENT_TYPES.nonInline,
    topLevelDirectory,
    reportPath: reportPath.slice(topLevelDirectory.length + 1),
    files,
    archive: {
      fileName: `${topLevelDirectory}${fileExtension}`,
      mediaType: 'application/zip',
      byteSize: archiveBuffer.byteLength,
      sha256: sha256(archiveBuffer),
      base64: archiveBuffer.toString('base64'),
    },
    warnings: buildPackagingWarnings(pkg),
  };
}

function buildTopLevelDirectory(pkg: FilingPackage): string {
  const runId = pkg.evidenceLink.runId || 'filing';
  return sanitizePackageName(`${pkg.adapterId}-${runId}`);
}

function buildReportFileName(pkg: FilingPackage): string {
  const baseName = sanitizePackageName(pkg.evidenceLink.runId || 'report');
  if (pkg.format === 'xbrl') return `${baseName}.xbrl`;
  if (pkg.format === 'xbrl-csv') return `${baseName}.json`;
  return `${baseName}.json`;
}

function renderReportContent(pkg: FilingPackage): {
  text: string;
  mediaType: string;
  additionalFiles: Array<{ path: string; mediaType: string; text: string }>;
} {
  if (pkg.format === 'xbrl') {
    return {
      text: renderXbrlInstance(pkg),
      mediaType: 'application/xml',
      additionalFiles: [],
    };
  }
  if (pkg.format === 'xbrl-csv') {
    return renderXbrlCsvPackage(pkg);
  }
  return {
    text: JSON.stringify(pkg.content, null, 2),
    mediaType: 'application/json',
    additionalFiles: [],
  };
}

function renderXbrlInstance(pkg: FilingPackage): string {
  const content = pkg.content as Record<string, any>;
  const context = content.context ?? {};
  const facts = Array.isArray(content.facts) ? content.facts : [];
  const schemaRef = typeof content.schemaRef === 'string' ? content.schemaRef : null;
  const entityIdentifier = typeof context.entity === 'string' ? context.entity : 'attestor-governed-entity';
  const instant = normalizeDate(typeof context.period === 'string' ? context.period : undefined);

  const units = new Map<string, string>();
  for (const fact of facts) {
    const unit = normalizeUnit(fact.unit);
    if (!unit) continue;
    if (!units.has(unit)) {
      units.set(unit, `u${unit.replace(/[^A-Za-z0-9]/g, '')}`);
    }
  }

  const root = create({ version: '1.0', encoding: 'UTF-8' }).ele('xbrli:xbrl', {
    xmlns_xbrli: XBRL_NAMESPACES.xbrli,
    xmlns_link: XBRL_NAMESPACES.link,
    xmlns_xlink: XBRL_NAMESPACES.xlink,
    xmlns_iso4217: XBRL_NAMESPACES.iso4217,
    xmlns_us_gaap: XBRL_NAMESPACES.us_gaap,
    xmlns_dei: XBRL_NAMESPACES.dei,
    xmlns_attestor: XBRL_NAMESPACES.attestor,
  });

  if (schemaRef) {
    root.ele('link:schemaRef', {
      'xlink:type': 'simple',
      'xlink:href': schemaRef,
    });
  }

  const contextNode = root.ele('xbrli:context', { id: 'c1' });
  const entityNode = contextNode.ele('xbrli:entity');
  entityNode.ele('xbrli:identifier', { scheme: 'https://attestor.dev/entity' }).txt(entityIdentifier);
  const periodNode = contextNode.ele('xbrli:period');
  periodNode.ele('xbrli:instant').txt(instant);

  for (const [unit, id] of units.entries()) {
    const unitNode = root.ele('xbrli:unit', { id });
    unitNode.ele('xbrli:measure').txt(unit);
  }

  for (const fact of facts) {
    const concept = typeof fact.concept === 'string' ? fact.concept : 'attestor:UnmappedFact';
    const tagName = qnameToXmlTag(concept);
    const attrs: Record<string, string> = { contextRef: 'c1' };
    const unit = normalizeUnit(fact.unit);
    if (unit && units.has(unit)) {
      attrs.unitRef = units.get(unit)!;
      attrs.decimals = typeof fact.value === 'number' && Number.isInteger(fact.value) ? '0' : '2';
    }
    root.ele(tagName, attrs).txt(valueToFactString(fact.value));
  }

  return root.end({ prettyPrint: true });
}

function renderXbrlCsvPackage(pkg: FilingPackage): {
  text: string;
  mediaType: string;
  additionalFiles: Array<{ path: string; mediaType: string; text: string }>;
} {
  const content = pkg.content as Record<string, any>;
  const tables = Array.isArray(content.tables) ? content.tables : [];
  const taxonomyVersion = typeof content.taxonomyVersion === 'string' ? content.taxonomyVersion : 'Unknown';
  const templateId = typeof content.metadata?.templateId === 'string' ? content.metadata.templateId : 'attestor_template';
  const currency = typeof content.metadata?.currency === 'string' ? content.metadata.currency : 'USD';
  const period = '2026-03-28T00:00:00';
  const csvFiles: Array<{ path: string; mediaType: string; text: string }> = [];
  const metadataTables: Record<string, unknown> = {};
  const metadataTemplates: Record<string, unknown> = {};

  tables.forEach((table: any, index: number) => {
    const tableCode = sanitizePackageName(typeof table.tableCode === 'string' ? table.tableCode : `table_${index + 1}`);
    const title = typeof table.title === 'string' ? table.title : tableCode;
    const columns = Array.isArray(table.columns) ? table.columns : [];
    const header = columns.map((column: any) => String(column.name));
    const row = columns.map((column: any) => csvCell(column.value));
    const csvText = `${header.join(',')}\n${row.join(',')}\n`;
    const csvPath = `reports/${tableCode}.csv`;
    csvFiles.push({ path: csvPath, mediaType: 'text/csv', text: csvText });

    const templateName = `${tableCode}_template`;
    metadataTemplates[templateName] = {
      columns: Object.fromEntries(columns.map((column: any) => [
        String(column.name),
        {
          dimensions: buildCsvDimensions(column.dpmConcept ?? column.name, currency, period),
        },
      ])),
    };
    metadataTables[tableCode] = {
      template: templateName,
      url: `${tableCode}.csv`,
      label: title,
    };
  });

  const metadata = {
    documentInfo: {
      documentType: XBRL_CSV_DOCUMENT_TYPE,
      namespaces: {
        eba_met: XBRL_NAMESPACES.eba_met,
        eba_dim: XBRL_NAMESPACES.eba_dim,
        attestor: XBRL_NAMESPACES.attestor,
        iso4217: XBRL_NAMESPACES.iso4217,
      },
      taxonomy: [
        `https://www.eba.europa.eu/dpm/${encodeURIComponent(taxonomyVersion)}`,
      ],
    },
    parameters: {
      reportCurrency: `iso4217:${currency}`,
    },
    tableTemplates: metadataTemplates,
    tables: metadataTables,
  };

  return {
    text: JSON.stringify(metadata, null, 2),
    mediaType: 'application/json',
    additionalFiles: csvFiles,
  };
}

function buildCsvDimensions(concept: string, currency: string, period: string): Record<string, string> {
  const dimensions: Record<string, string> = {
    concept: String(concept),
    entity: 'attestor:hosted-account',
    period,
  };
  if (needsUnit(concept)) {
    dimensions.unit = `iso4217:${currency}`;
  }
  return dimensions;
}

function needsUnit(concept: string): boolean {
  return !/Axis$/.test(concept) && !/dimension/i.test(concept);
}

function qnameToXmlTag(concept: string): string {
  const [prefix, local] = concept.split(':');
  const xmlPrefix = prefix === 'us-gaap' ? 'us_gaap' : prefix;
  if (!local) return `attestor:${sanitizeXmlName(prefix)}`;
  return `${sanitizeXmlName(xmlPrefix)}:${sanitizeXmlName(local)}`;
}

function sanitizeXmlName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function normalizeDate(value?: string): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  return value.includes('T') ? value.slice(0, 10) : value;
}

function normalizeUnit(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (/^[A-Z]{3}$/.test(value)) return `iso4217:${value}`;
  return value;
}

function valueToFactString(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return '';
  return String(value);
}

function buildPackagingWarnings(pkg: FilingPackage): string[] {
  const warnings = [...pkg.validation.warnings];
  if (pkg.format === 'xbrl') {
    warnings.push('Current package issuance produces a non-inline XBRL report package around Attestor-generated instance XML; taxonomy validation and regulator submission remain out of scope.');
  }
  if (pkg.format === 'xbrl-csv') {
    warnings.push('Current xBRL-CSV package issuance emits single-row metadata + CSV tables for handoff/import, but does not run EBA taxonomy validation.');
  }
  return warnings;
}

function fileDescriptor(path: string, mediaType: string, buffer: Buffer): FilingIssuedPackageFile {
  return {
    path,
    mediaType,
    sizeBytes: buffer.byteLength,
    sha256: sha256(buffer),
  };
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function sanitizePackageName(value: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'attestor-filing';
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}
