'use strict';
/**
 * Single source of truth for citizen profile fields. Used by onboarding forms,
 * validation, the eligibility engine, and the admin rule editor.
 * Nothing here asks for Aadhaar, bank details, OTPs or other identity numbers.
 */

const GENDERS = [
  ['female', 'Female'], ['male', 'Male'], ['transgender', 'Transgender'], ['prefer_not', 'Prefer not to say'],
];
const RESIDENCE = [['rural', 'Rural (village)'], ['urban', 'Urban (town/city)']];
const EDUCATION = [
  ['none', 'No formal schooling'],
  ['primary', 'Primary (Class 1–5)'],
  ['middle', 'Middle (Class 6–8)'],
  ['secondary', 'Secondary (Class 9–10)'],
  ['higher_secondary', 'Higher Secondary (Class 11–12)'],
  ['diploma', 'Diploma / ITI'],
  ['undergraduate', 'Undergraduate (pursuing or completed)'],
  ['postgraduate', 'Postgraduate'],
  ['doctorate', 'PhD / Doctorate'],
];
const EMPLOYMENT = [
  ['student', 'Student'],
  ['unemployed', 'Unemployed / looking for work'],
  ['self_employed', 'Self-employed / own business'],
  ['salaried_private', 'Salaried (private sector)'],
  ['salaried_govt', 'Salaried (government / PSU)'],
  ['daily_wage', 'Daily wage / casual labour'],
  ['homemaker', 'Homemaker'],
  ['retired', 'Retired'],
];
const OCCUPATION = [
  ['farmer', 'Farmer / cultivator'],
  ['agri_labourer', 'Agricultural labourer'],
  ['fisher', 'Fisher'],
  ['artisan', 'Artisan / craftsperson'],
  ['street_vendor', 'Street vendor'],
  ['construction_worker', 'Construction worker'],
  ['domestic_worker', 'Domestic worker'],
  ['shopkeeper', 'Shopkeeper / small trader'],
  ['driver', 'Driver / transport worker'],
  ['professional', 'Professional (doctor, lawyer, engineer, CA…)'],
  ['office_worker', 'Office / clerical work'],
  ['other', 'Other'],
  ['none', 'None'],
];
const SOCIAL_CATEGORY = [
  ['general', 'General'], ['obc', 'OBC'], ['sc', 'SC'], ['st', 'ST'], ['ews', 'EWS'], ['prefer_not', 'Prefer not to say'],
];
const MARITAL = [
  ['unmarried', 'Unmarried'], ['married', 'Married'], ['widowed', 'Widowed'], ['divorced', 'Divorced / separated'], ['prefer_not', 'Prefer not to say'],
];

// Beneficiary flags — each is a yes/no question. Unanswered = unknown.
const FLAGS = [
  ['is_farmer_landholder', 'My family owns or cultivates agricultural land'],
  ['land_upto_2ha', 'Our cultivable land is 2 hectares (≈5 acres) or less'],
  ['is_bpl', 'We have a BPL / Antyodaya / priority household ration card'],
  ['has_ration_card', 'We have a ration card (any type)'],
  ['owns_pucca_house', 'My family owns a pucca (permanent) house'],
  ['has_lpg_connection', 'My household already has an LPG connection'],
  ['has_bank_account', 'I have a bank or post-office savings account'],
  ['is_income_tax_payer', 'I (or my family) pay income tax'],
  ['is_govt_employee_family', 'Someone in my family is a government employee'],
  ['has_epf_esic_nps', 'I am covered by EPF / ESIC / NPS'],
  ['is_minority', 'I belong to a notified minority community'],
  ['has_disability', 'I have a disability (with or without certificate)'],
  ['is_pregnant_or_lactating', 'I am pregnant or a breastfeeding mother'],
  ['has_girl_child_under_10', 'I have a daughter below 10 years of age'],
  ['studied_govt_school_6_12', 'I studied Class 6–12 in a government school'],
  ['is_head_of_family', 'I am the head of my family (as per ration card)'],
  ['is_unorganised_worker', 'I work in the unorganised / informal sector'],
  ['owns_house_roof', 'My family owns a house with a usable roof (for solar)'],
  ['is_enrolled_in_education', 'I am currently enrolled in school / college'],
  ['has_existing_enterprise', 'I already run a business / enterprise'],
];

/** Field catalog for the rules engine. type: number | enum | bool | location */
const FIELDS = {
  age: { label: 'Age', type: 'number', unit: 'years' },
  gender: { label: 'Gender', type: 'enum', options: GENDERS },
  residence: { label: 'Rural / Urban', type: 'enum', options: RESIDENCE },
  education: { label: 'Education level', type: 'enum', options: EDUCATION, ordered: true },
  employment: { label: 'Employment status', type: 'enum', options: EMPLOYMENT },
  occupation: { label: 'Occupation', type: 'enum', options: OCCUPATION },
  annual_income: { label: 'Annual household income', type: 'number', unit: '₹' },
  monthly_income: { label: 'Monthly personal income', type: 'number', unit: '₹', derived: true },
  family_size: { label: 'Family size', type: 'number' },
  social_category: { label: 'Social category', type: 'enum', options: SOCIAL_CATEGORY },
  marital_status: { label: 'Marital status', type: 'enum', options: MARITAL },
  disability_percent: { label: 'Disability percentage (certificate)', type: 'number', unit: '%' },
  class12_percent: { label: 'Class 12 marks', type: 'number', unit: '%' },
  last_exam_percent: { label: 'Marks in last exam', type: 'number', unit: '%' },
};
for (const [key, label] of FLAGS) FIELDS[key] = { label, type: 'bool' };

const EDU_ORDER = EDUCATION.map(([k]) => k);

/** Questions that are worth asking for, mapped to the onboarding section they live in. */
const FIELD_SECTION = {
  age: 'basic', gender: 'basic', residence: 'location', education: 'education', employment: 'work',
  occupation: 'work', annual_income: 'family', monthly_income: 'family', family_size: 'family',
  social_category: 'family', marital_status: 'family', disability_percent: 'circumstances',
  class12_percent: 'education', last_exam_percent: 'education',
};
for (const [key] of FLAGS) FIELD_SECTION[key] = 'circumstances';

const CATEGORY_TAGS = [
  ['farmer', 'Farmers'], ['student', 'Students'], ['women', 'Women & girls'], ['senior', 'Senior citizens'],
  ['worker', 'Workers'], ['entrepreneur', 'Entrepreneurs'], ['disability', 'Persons with disabilities'],
  ['health', 'Health'], ['housing', 'Housing'], ['pension', 'Pension & insurance'], ['sc_st', 'SC / ST'],
  ['obc', 'OBC / minorities'], ['children', 'Children'], ['food', 'Food security'], ['skills', 'Skills & jobs'],
  ['energy', 'Energy'], ['financial_inclusion', 'Banking'],
];

function optionLabel(list, key) {
  const f = list.find(([k]) => k === key);
  return f ? f[1] : key;
}

module.exports = {
  GENDERS, RESIDENCE, EDUCATION, EMPLOYMENT, OCCUPATION, SOCIAL_CATEGORY, MARITAL, FLAGS,
  FIELDS, EDU_ORDER, FIELD_SECTION, CATEGORY_TAGS, optionLabel,
};
