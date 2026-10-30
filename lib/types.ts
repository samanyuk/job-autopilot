export type Ats =
  | "workday"
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "icims"
  | "oracle"
  | "amazon"
  | "other";

export interface Job {
  id: string;
  company: string;
  title: string;
  url: string;
  companyUrl: string;
  locations: string[];
  category: string;
  degrees: string[];
  terms: string[];
  sponsorship: string;
  postedAt: number; // unix seconds
  updatedAt: number;
  ats: Ats;
}

export interface Education {
  school: string;
  degree: string; // e.g. "Bachelor of Science"
  field: string; // e.g. "Computer Science"
  gpa: string;
  startDate: string; // free text, e.g. "Sep 2024"
  endDate: string; // e.g. "Jun 2028"
}

export interface Experience {
  title: string;
  company: string;
  location: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
}

export interface Profile {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  phoneCountryCode: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  linkedin: string;
  github: string;
  website: string;
  summary: string;
  skills: string[];
  education: Education[];
  experience: Experience[];
  // Common screening answers
  workAuthorized: "yes" | "no" | "";
  needsSponsorship: "yes" | "no" | "";
  over18: "yes" | "no" | "";
  previouslyEmployed: "yes" | "no" | "";
  relocate: "yes" | "no" | "";
  gradMonthYear: string; // e.g. "06/2028"
  degreeLevel: "High School" | "Associate" | "Bachelor's" | "Master's" | "PhD" | "";
  howHeard: string;
  rawText: string;
}

export interface ResumeFile {
  name: string;
  type: string;
  b64: string;
}

export interface JobDescription {
  url: string;
  text: string; // plain text description
  source: string;
  fetchedAt: number;
}

export interface ScoreBreakdown {
  total: number;
  skills: number;
  role: number;
  education: number;
  location: number;
  matchedSkills: string[];
  missingSkills: string[];
  hasDescription: boolean;
}

export type JobStatus = "applied" | "skipped" | "saved";

export interface JobStatusEntry {
  status: JobStatus;
  at: number;
  jobId: string;
  company: string;
  title: string;
  url: string;
}
