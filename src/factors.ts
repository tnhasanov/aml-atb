/**
 * The risk factor catalogue of Part 3 of the Rules.
 *
 * Each entry is a one-to-one mapping onto a clause, so every risk determination
 * the assistant makes can be traced back to the text that authorises it. The
 * English labels are working translations for the tool interface; the clause
 * text in data/rules.json remains the authoritative wording.
 *
 * Clauses 3.4-3.8 list factors that MAY be classified low risk.
 * Clauses 3.9-3.13 list factors that MAY be classified high risk.
 */

export type Polarity = "high" | "low";
export type Category = "customer" | "product" | "channel" | "geography" | "transaction";

export interface Factor {
  key: string;
  clause: string;
  category: Category;
  polarity: Polarity;
  label_en: string;
}

export const FACTORS: Factor[] = [
  // ---- Customer, low risk (3.4) ----
  f("notary_or_auditor_own_operations", "3.4.1", "customer", "low", "Notaries and auditors in respect of their own operations"),
  f("international_organisation", "3.4.2", "customer", "low", "International organisations of which Azerbaijan is a member"),
  f("listed_transparent_company", "3.4.3", "customer", "low", "Companies listed on stock exchanges with disclosure and beneficial-ownership transparency requirements (credit institutions excluded)"),
  f("income_consistent_with_spending", "3.4.4", "customer", "low", "Customers whose lawful income sources match their overall expenditure"),
  f("other_low_risk_customer", "3.4.5", "customer", "low", "Other customers assessed as low risk"),

  // ---- Product / service, low risk (3.5) ----
  f("loan_under_20k_azn", "3.5.1", "product", "low", "Loans to natural persons below AZN 20,000"),
  f("card_restricted_incoming_transfers", "3.5.2", "product", "low", "Bank cards restricted from receiving money transfers"),
  f("term_deposit", "3.5.3", "product", "low", "Term deposits"),
  f("other_low_risk_product", "3.5.4", "product", "low", "Other products or services assessed as low risk"),

  // ---- Delivery channel, low risk (3.6) ----
  f("dedicated_salary_account", "3.6.1", "channel", "low", "Salary accounts not used for other purposes"),
  f("pension_or_social_benefit_account", "3.6.2", "channel", "low", "Pension, stipend and social benefit accounts"),
  f("non_life_insurance_cashless", "3.6.3", "channel", "low", "Cashless non-life insurance payments (except where premium refund is possible)"),
  f("utility_payments", "3.6.4", "channel", "low", "Utility payments"),
  f("face_to_face_channel", "3.6.5", "channel", "low", "Other channels using face-to-face technologies for transactions"),
  f("other_low_risk_channel", "3.6.6", "channel", "low", "Other delivery channels assessed as low risk"),

  // ---- Geography, low risk (3.7) ----
  f("adequate_aml_system", "3.7.1", "geography", "low", "States with an adequate AML/CFT system per credible sources (mutual evaluation, detailed or follow-up reports)"),
  f("low_crime_level", "3.7.2", "geography", "low", "States confirmed by credible sources to have a low level of crime"),
  f("high_transparency", "3.7.3", "geography", "low", "Countries with high transparency of commercial and banking secrecy information"),
  f("other_low_risk_country", "3.7.4", "geography", "low", "Other states assessed as low risk"),

  // ---- Transaction, low risk (3.8) ----
  f("domestic_transfer_under_5k_azn_monthly", "3.8.1", "transaction", "low", "Domestic electronic funds transfers of AZN 5,000 or less within a month"),
  f("linked_to_low_risk_factors", "3.8.2", "transaction", "low", "Transactions linked to the low-risk customers, products, channels or states in clauses 3.4-3.7"),
  f("other_low_risk_transaction", "3.8.3", "transaction", "low", "Other transactions assessed as low risk"),

  // ---- Customer, high risk (3.9) ----
  f("pep_or_relative_or_associate", "3.9.1", "customer", "high", "Politically exposed persons, their close relatives or close associates"),
  f("unusual_relationship", "3.9.2", "customer", "high", "Business relationship established or continued in an unusual manner (e.g. significant geographic distance from the institution)"),
  f("non_resident_customer", "3.9.3", "customer", "high", "Non-resident customers"),
  f("prior_suspicious_transactions", "3.9.4", "customer", "high", "Customers who have carried out suspicious transactions"),
  f("linked_to_high_risk_country", "3.9.5", "customer", "high", "Customers connected with the high-risk states listed in clause 3.12"),
  f("personal_asset_holder", "3.9.6", "customer", "high", "Persons acting as personal asset holders or managers"),
  f("foreign_legal_arrangement", "3.9.7", "customer", "high", "Foreign legal arrangements"),
  f("money_mule", "3.9.8", "customer", "high", "Persons whose accounts are used for other people's purposes (money mules)"),
  f("nominee_or_bearer_shares", "3.9.9", "customer", "high", "Legal persons with nominee holders or bearer shares"),
  f("cash_or_virtual_asset_intensive", "3.9.10", "customer", "high", "Business activity that regularly uses (or intends to use) cash and virtual assets"),
  f("complex_ownership_chain", "3.9.11", "customer", "high", "Ownership or control chain that is unusual and excessively complex relative to the business activity"),
  f("shell_company", "3.9.12", "customer", "high", "Shell companies (registered legal persons with no physical presence)"),
  f("other_high_risk_customer", "3.9.13", "customer", "high", "Other customers assessed as high risk"),

  // ---- Product / service, high risk (3.10) ----
  f("private_banking_hnwi", "3.10.1", "product", "high", "Financial and non-financial services for high-net-worth individuals"),
  f("anonymity_enabling_product", "3.10.2", "product", "high", "Products or services offering anonymity"),
  f("numbered_account", "3.10.3", "product", "high", "Numbered accounts where the customer's name is kept confidential"),
  f("new_technology_product", "3.10.4", "product", "high", "Products or services involving new technologies"),
  f("foreign_legal_arrangement_services", "3.10.5", "product", "high", "Services to foreign legal arrangements"),
  f("asset_management_services", "3.10.6", "product", "high", "Asset management services"),
  f("trade_finance", "3.10.7", "product", "high", "Trade finance services"),
  f("prepaid_card", "3.10.8", "product", "high", "Prepaid cards"),
  f("large_denomination_deposit", "3.10.9", "product", "high", "Large-denomination deposits"),
  f("other_high_risk_product", "3.10.10", "product", "high", "Other products or services assessed as high risk"),

  // ---- Delivery channel, high risk (3.11) ----
  f("anonymous_funding", "3.11.1", "channel", "high", "Anonymous incoming (funding) transactions"),
  f("electronic_or_mobile_banking", "3.11.2", "channel", "high", "Electronic and mobile banking services"),
  f("payable_through_account", "3.11.3", "channel", "high", "Direct use of a correspondent account by third parties (payable-through account)"),
  f("transit_account", "3.11.4", "channel", "high", "Transit accounts"),
  f("non_face_to_face_new_technology", "3.11.5", "channel", "high", "Use of new (non-face-to-face) technologies for transactions"),
  f("pooled_or_centralised_account", "3.11.6", "channel", "high", "Special-use or centralised accounts used to pool funds"),
  f("card_ordered_online_mobile_app", "3.11.7", "channel", "high", "Bank cards ordered online and operated through a mobile application"),
  f("other_high_risk_channel", "3.11.8", "channel", "high", "Other delivery channels assessed as high risk"),

  // ---- Geography, high risk (3.12) ----
  f("no_adequate_aml_system", "3.12.1", "geography", "high", "States determined by credible sources to lack an adequate AML/CFT system"),
  f("supports_terrorism_or_conceals_identity", "3.12.2", "geography", "high", "States supporting armed separatism, extremism, mercenary or terrorist activity, not requiring identification data on financial transactions, and subject to international sanctions or analogous measures"),
  f("un_sanctioned_or_embargoed", "3.12.3", "geography", "high", "States subject to United Nations sanctions or embargo"),
  f("high_crime_level", "3.12.4", "geography", "high", "States confirmed by credible sources to have a high level of (particularly economic) crime"),
  f("laundering_hub_or_offshore", "3.12.5", "geography", "high", "Principal states identified for laundering of property, and offshore financial centres"),
  f("mmx_designated_high_risk", "3.12.6", "geography", "high", "States designated high risk by the Financial Monitoring Service under Article 9.5 of the Law"),
  f("other_high_risk_country", "3.12.7", "geography", "high", "Other states assessed as high risk"),

  // ---- Transaction, high risk (3.13) ----
  f("law_article_11_2_transaction", "3.13.1", "transaction", "high", "Transactions specified in Article 11.2 of the Law"),
  f("cash_funding", "3.13.2", "transaction", "high", "Cash incoming (funding) transactions"),
  f("payment_from_unrelated_third_party", "3.13.3", "transaction", "high", "Payments received from unrelated or unknown third parties"),
  f("inconsistent_or_unexplained_transfers", "3.13.4", "transaction", "high", "Transfers inconsistent with, or poorly explained by, the customer's business and history; unexplained, repetitive or unusually structured transfers"),
  f("transfer_without_valid_contract", "3.13.5", "transaction", "high", "Transfers not connected to a valid contract, product or service"),
  f("linked_to_high_risk_factors", "3.13.6", "transaction", "high", "Transactions linked to the high-risk customers, products, channels or states in clauses 3.9-3.12"),
  f("other_high_risk_transaction", "3.13.7", "transaction", "high", "Other transactions assessed as high risk"),
];

function f(
  key: string,
  clause: string,
  category: Category,
  polarity: Polarity,
  label_en: string,
): Factor {
  return { key, clause, category, polarity, label_en };
}

const byKey = new Map(FACTORS.map((x) => [x.key, x]));

export function getFactor(key: string): Factor | undefined {
  return byKey.get(key);
}

export function factorKeys(polarity?: Polarity): string[] {
  return FACTORS.filter((x) => !polarity || x.polarity === polarity).map((x) => x.key);
}

export const HIGH_RISK_FACTOR_KEYS = factorKeys("high");
export const LOW_RISK_FACTOR_KEYS = factorKeys("low");
