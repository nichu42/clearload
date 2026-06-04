import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dictDir = path.join(__dirname, '..', 'dictionaries');

let hasErrors = false;

function logError(file, message) {
  console.error(`❌ [Validation Error] in ${file}: ${message}`);
  hasErrors = true;
}

function logSuccess(file) {
  console.log(`✅ [OK] ${file} is valid, sorted, and clean.`);
}

// 1. Validate tracking_patterns.json
function validateArrayFile(filename) {
  const filePath = path.join(dictDir, filename);
  if (!fs.existsSync(filePath)) {
    logError(filename, `File does not exist at ${filePath}`);
    return;
  }

  let content;
  try {
    content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    logError(filename, `Failed to parse JSON: ${err.message}`);
    return;
  }

  if (!Array.isArray(content)) {
    logError(filename, `Root structure must be a JSON Array.`);
    return;
  }

  const seen = new Set();
  const sorted = [...content].sort();

  for (let i = 0; i < content.length; i++) {
    const item = content[i];
    if (typeof item !== 'string') {
      logError(filename, `Item at index ${i} is not a string: ${JSON.stringify(item)}`);
      continue;
    }

    if (item.trim() !== item) {
      logError(filename, `Item "${item}" has leading or trailing whitespace.`);
    }

    if (item.toLowerCase() !== item) {
      logError(filename, `Item "${item}" contains uppercase letters. All entries must be lowercase.`);
    }

    if (seen.has(item)) {
      logError(filename, `Duplicate entry found: "${item}"`);
    }
    seen.add(item);
  }

  // Check alphabetical sorting
  if (JSON.stringify(content) !== JSON.stringify(sorted)) {
    // Find the first out of order element for a better error message
    let outOfOrderIdx = -1;
    for (let i = 0; i < content.length; i++) {
      if (content[i] !== sorted[i]) {
        outOfOrderIdx = i;
        break;
      }
    }
    logError(filename, `Entries are not sorted alphabetically. First mismatch at index ${outOfOrderIdx}: found "${content[outOfOrderIdx]}", expected "${sorted[outOfOrderIdx]}".`);
  }

  if (!hasErrors) {
    logSuccess(filename);
  }
}

// 2. Validate cmp_mapping.json
function validateMappingFile(filename) {
  const filePath = path.join(dictDir, filename);
  if (!fs.existsSync(filePath)) {
    logError(filename, `File does not exist at ${filePath}`);
    return;
  }

  let content;
  try {
    content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    logError(filename, `Failed to parse JSON: ${err.message}`);
    return;
  }

  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    logError(filename, `Root structure must be a JSON Object (mapping keys to values).`);
    return;
  }

  const keys = Object.keys(content);
  const sortedKeys = [...keys].sort();

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const val = content[key];

    if (key.trim() !== key) {
      logError(filename, `Key "${key}" has leading or trailing whitespace.`);
    }

    if (key.toLowerCase() !== key) {
      logError(filename, `Key "${key}" contains uppercase letters. Keys (domains) must be lowercase.`);
    }

    if (typeof val !== 'string') {
      logError(filename, `Value for key "${key}" must be a string (got ${typeof val}).`);
    } else if (val.trim() === '') {
      logError(filename, `Value for key "${key}" cannot be empty.`);
    }
  }

  // Check alphabetical sorting of keys
  if (JSON.stringify(keys) !== JSON.stringify(sortedKeys)) {
    let outOfOrderIdx = -1;
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== sortedKeys[i]) {
        outOfOrderIdx = i;
        break;
      }
    }
    logError(filename, `Keys are not sorted alphabetically. First mismatch at index ${outOfOrderIdx}: found "${keys[outOfOrderIdx]}", expected "${sortedKeys[outOfOrderIdx]}".`);
  }

  if (!hasErrors) {
    logSuccess(filename);
  }
}

function validateStructuredMappingFile(filename, requiredFields) {
  const filePath = path.join(dictDir, filename);
  if (!fs.existsSync(filePath)) {
    logError(filename, `File does not exist at ${filePath}`);
    return;
  }

  let content;
  try {
    content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    logError(filename, `Failed to parse JSON: ${err.message}`);
    return;
  }

  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    logError(filename, `Root structure must be a JSON Object.`);
    return;
  }

  const keys = Object.keys(content);
  const sortedKeys = [...keys].sort();

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const val = content[key];

    if (key.trim() !== key) {
      logError(filename, `Key "${key}" has leading or trailing whitespace.`);
    }

    if (typeof val !== 'object' || val === null || Array.isArray(val)) {
      logError(filename, `Value for key "${key}" must be a structured JSON Object.`);
      continue;
    }

    for (const field of requiredFields) {
      if (typeof val[field] !== 'string') {
        logError(filename, `Field "${field}" for key "${key}" must be a string.`);
      } else if (val[field].trim() === '') {
        logError(filename, `Field "${field}" for key "${key}" cannot be empty.`);
      }
    }
  }

  // Check alphabetical sorting of keys
  if (JSON.stringify(keys) !== JSON.stringify(sortedKeys)) {
    let outOfOrderIdx = -1;
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== sortedKeys[i]) {
        outOfOrderIdx = i;
        break;
      }
    }
    logError(filename, `Keys are not sorted alphabetically. First mismatch at index ${outOfOrderIdx}: found "${keys[outOfOrderIdx]}", expected "${sortedKeys[outOfOrderIdx]}".`);
  }

  if (!hasErrors) {
    logSuccess(filename);
  }
}

// 5. Validate classification_rules.json
function validateHeuristicsRulesFile(filename) {
  const filePath = path.join(dictDir, filename);
  if (!fs.existsSync(filePath)) {
    logError(filename, `File does not exist at ${filePath}`);
    return;
  }

  let content;
  try {
    content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    logError(filename, `Failed to parse JSON: ${err.message}`);
    return;
  }

  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    logError(filename, `Root structure must be a JSON Object.`);
    return;
  }

  const categories = Object.keys(content);
  const sortedCategories = [...categories].sort();

  if (JSON.stringify(categories) !== JSON.stringify(sortedCategories)) {
    logError(filename, `Root categories are not sorted alphabetically.`);
  }

  categories.forEach(category => {
    if (category !== 'Strictly Necessary' && category !== 'Analytics' && category !== 'Marketing/Advertising') {
      logError(filename, `Invalid category: "${category}". Must be one of: "Strictly Necessary", "Analytics", "Marketing/Advertising".`);
    }

    const rules = content[category];
    if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) {
      logError(filename, `Category "${category}" must map to an object of rule lists.`);
      return;
    }

    const ruleTypes = Object.keys(rules);
    const sortedRuleTypes = [...ruleTypes].sort();

    if (JSON.stringify(ruleTypes) !== JSON.stringify(sortedRuleTypes)) {
      logError(filename, `Rule types under category "${category}" are not sorted alphabetically.`);
    }

    ruleTypes.forEach(type => {
      if (type !== 'includes' && type !== 'starts_with' && type !== 'exact' && type !== 'domains') {
        logError(filename, `Invalid rule type: "${type}" in category "${category}". Must be one of: "includes", "starts_with", "exact", "domains".`);
      }

      const list = rules[type];
      if (!Array.isArray(list)) {
        logError(filename, `Rule type "${type}" in category "${category}" must be an array.`);
        return;
      }

      const seen = new Set();
      const sortedList = [...list].sort();

      for (let i = 0; i < list.length; i++) {
        const val = list[i];
        if (typeof val !== 'string') {
          logError(filename, `Rule item at category "${category}", type "${type}", index ${i} is not a string.`);
          continue;
        }

        if (val.trim() !== val) {
          logError(filename, `Rule item "${val}" in category "${category}", type "${type}" has whitespace.`);
        }

        if (val.toLowerCase() !== val) {
          logError(filename, `Rule item "${val}" in category "${category}", type "${type}" must be lowercase.`);
        }

        if (seen.has(val)) {
          logError(filename, `Duplicate item "${val}" in category "${category}", type "${type}".`);
        }
        seen.add(val);
      }

      if (JSON.stringify(list) !== JSON.stringify(sortedList)) {
        logError(filename, `Array for category "${category}", type "${type}" is not sorted alphabetically.`);
      }
    });
  });

  if (!hasErrors) {
    logSuccess(filename);
  }
}

console.log('🤖 Running dictionary validation checks...');
validateArrayFile('tracking_patterns.json');
validateArrayFile('public_cdns.json');
validateMappingFile('cmp_mapping.json');
validateStructuredMappingFile('cookie_definitions.json', ['category', 'description']);
validateStructuredMappingFile('widget_mappings.json', ['name', 'category']);
validateHeuristicsRulesFile('classification_rules.json');

if (hasErrors) {
  console.error('\n❌ Dictionary validation FAILED. Please correct the errors listed above.');
  process.exit(1);
} else {
  console.log('\n🌟 All dictionaries validated successfully!');
  process.exit(0);
}
