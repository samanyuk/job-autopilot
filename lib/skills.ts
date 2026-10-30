// A vocabulary of technical skills with aliases. Used both for pulling skills
// out of a resume and for pulling requirements out of a job description.

export interface SkillDef {
  name: string;
  aliases: string[];
  group: "language" | "framework" | "tool" | "concept" | "cloud" | "data";
}

export const SKILLS: SkillDef[] = [
  { name: "Python", aliases: ["python"], group: "language" },
  { name: "Java", aliases: ["java"], group: "language" },
  { name: "JavaScript", aliases: ["javascript", "js", "es6"], group: "language" },
  { name: "TypeScript", aliases: ["typescript", "ts"], group: "language" },
  { name: "C++", aliases: ["c++", "cpp"], group: "language" },
  { name: "C", aliases: ["c programming", "c language", "c/c++"], group: "language" },
  { name: "C#", aliases: ["c#", "csharp"], group: "language" },
  { name: "Go", aliases: ["golang", "go lang"], group: "language" },
  { name: "Rust", aliases: ["rust"], group: "language" },
  { name: "Swift", aliases: ["swift"], group: "language" },
  { name: "Kotlin", aliases: ["kotlin"], group: "language" },
  { name: "Ruby", aliases: ["ruby", "rails"], group: "language" },
  { name: "PHP", aliases: ["php"], group: "language" },
  { name: "Scala", aliases: ["scala"], group: "language" },
  { name: "R", aliases: ["r programming", "r language"], group: "language" },
  { name: "MATLAB", aliases: ["matlab"], group: "language" },
  { name: "SQL", aliases: ["sql", "mysql", "postgres", "postgresql", "sqlite"], group: "data" },
  { name: "NoSQL", aliases: ["nosql", "mongodb", "dynamodb", "cassandra"], group: "data" },
  { name: "HTML/CSS", aliases: ["html", "css", "html5", "css3", "scss", "sass"], group: "language" },
  { name: "Bash", aliases: ["bash", "shell scripting", "shell"], group: "tool" },
  { name: "Verilog", aliases: ["verilog", "systemverilog", "vhdl"], group: "language" },
  { name: "Assembly", aliases: ["assembly", "x86", "arm assembly"], group: "language" },

  { name: "React", aliases: ["react", "react.js", "reactjs"], group: "framework" },
  { name: "React Native", aliases: ["react native"], group: "framework" },
  { name: "Next.js", aliases: ["next.js", "nextjs"], group: "framework" },
  { name: "Angular", aliases: ["angular", "angularjs"], group: "framework" },
  { name: "Vue", aliases: ["vue", "vue.js", "vuejs"], group: "framework" },
  { name: "Node.js", aliases: ["node", "node.js", "nodejs", "express"], group: "framework" },
  { name: "Django", aliases: ["django"], group: "framework" },
  { name: "Flask", aliases: ["flask", "fastapi"], group: "framework" },
  { name: "Spring", aliases: ["spring", "spring boot"], group: "framework" },
  { name: ".NET", aliases: [".net", "dotnet", "asp.net"], group: "framework" },
  { name: "Flutter", aliases: ["flutter", "dart"], group: "framework" },
  { name: "iOS", aliases: ["ios", "swiftui", "xcode"], group: "framework" },
  { name: "Android", aliases: ["android"], group: "framework" },
  { name: "GraphQL", aliases: ["graphql"], group: "framework" },
  { name: "REST APIs", aliases: ["rest", "restful", "rest api", "apis"], group: "concept" },

  { name: "PyTorch", aliases: ["pytorch", "torch"], group: "framework" },
  { name: "TensorFlow", aliases: ["tensorflow", "keras"], group: "framework" },
  { name: "scikit-learn", aliases: ["scikit-learn", "sklearn", "scikit learn"], group: "framework" },
  { name: "Pandas", aliases: ["pandas"], group: "framework" },
  { name: "NumPy", aliases: ["numpy"], group: "framework" },
  { name: "Machine Learning", aliases: ["machine learning", "ml"], group: "concept" },
  { name: "Deep Learning", aliases: ["deep learning", "neural network", "neural networks"], group: "concept" },
  { name: "Reinforcement Learning", aliases: ["reinforcement learning", "rl"], group: "concept" },
  { name: "Computer Vision", aliases: ["computer vision", "opencv"], group: "concept" },
  { name: "NLP", aliases: ["nlp", "natural language processing", "llm", "llms", "large language model"], group: "concept" },
  { name: "Data Science", aliases: ["data science", "data analysis", "analytics"], group: "concept" },
  { name: "Data Engineering", aliases: ["data engineering", "etl", "data pipeline", "data pipelines"], group: "concept" },
  { name: "Spark", aliases: ["spark", "pyspark", "hadoop"], group: "data" },
  { name: "Tableau", aliases: ["tableau", "power bi", "looker"], group: "tool" },
  { name: "Statistics", aliases: ["statistics", "statistical", "probability"], group: "concept" },

  { name: "AWS", aliases: ["aws", "amazon web services", "ec2", "s3", "lambda"], group: "cloud" },
  { name: "GCP", aliases: ["gcp", "google cloud"], group: "cloud" },
  { name: "Azure", aliases: ["azure"], group: "cloud" },
  { name: "Firebase", aliases: ["firebase", "firestore"], group: "cloud" },
  { name: "Docker", aliases: ["docker", "containers"], group: "tool" },
  { name: "Kubernetes", aliases: ["kubernetes", "k8s"], group: "tool" },
  { name: "CI/CD", aliases: ["ci/cd", "cicd", "github actions", "jenkins"], group: "tool" },
  { name: "Linux", aliases: ["linux", "unix"], group: "tool" },
  { name: "Git", aliases: ["git", "github", "gitlab", "version control"], group: "tool" },
  { name: "Terraform", aliases: ["terraform"], group: "tool" },

  { name: "Data Structures & Algorithms", aliases: ["data structures", "algorithms", "dsa"], group: "concept" },
  { name: "Object-Oriented Programming", aliases: ["object-oriented", "object oriented", "oop"], group: "concept" },
  { name: "Distributed Systems", aliases: ["distributed systems", "distributed"], group: "concept" },
  { name: "Operating Systems", aliases: ["operating systems"], group: "concept" },
  { name: "Networking", aliases: ["networking", "tcp/ip", "network protocols"], group: "concept" },
  { name: "Embedded Systems", aliases: ["embedded", "embedded systems", "firmware", "rtos"], group: "concept" },
  { name: "Robotics", aliases: ["robotics", "ros", "ros2"], group: "concept" },
  { name: "Autonomous Vehicles", aliases: ["autonomous", "autonomous driving", "self-driving", "carla", "simulation"], group: "concept" },
  { name: "Cybersecurity", aliases: ["security", "cybersecurity", "cryptography"], group: "concept" },
  { name: "Testing", aliases: ["unit testing", "testing", "jest", "pytest", "test automation"], group: "concept" },
  { name: "Agile", aliases: ["agile", "scrum"], group: "concept" },
  { name: "Figma", aliases: ["figma"], group: "tool" },
  { name: "Full Stack", aliases: ["full stack", "full-stack", "fullstack"], group: "concept" },
  { name: "Front End", aliases: ["front end", "front-end", "frontend"], group: "concept" },
  { name: "Back End", aliases: ["back end", "back-end", "backend"], group: "concept" },
  { name: "Mobile Development", aliases: ["mobile", "mobile development", "mobile app"], group: "concept" },
  { name: "Game Development", aliases: ["game development", "unity", "unreal", "game dev"], group: "concept" },
  { name: "Excel", aliases: ["excel", "spreadsheets"], group: "tool" },
  { name: "Product Management", aliases: ["product management", "product manager", "roadmap"], group: "concept" },
  { name: "Quantitative", aliases: ["quantitative", "quant", "trading", "finance"], group: "concept" },
  { name: "Circuit Design", aliases: ["circuit", "pcb", "analog", "digital design", "fpga"], group: "concept" },
];

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const compiled = SKILLS.map((s) => ({
  def: s,
  regexes: s.aliases.map((a) => {
    // Word boundaries don't work around symbols like "c++" or ".net", so pad
    // those with lookarounds for whitespace/punctuation instead.
    const esc = escapeRegex(a);
    return new RegExp(`(?<![a-z0-9+#.])${esc}(?![a-z0-9+#])`, "i");
  }),
}));

/** Return the skill names found in a chunk of text, in vocabulary order. */
export function extractSkills(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const { def, regexes } of compiled) {
    if (regexes.some((r) => r.test(lower))) {
      found.push(def.name);
    }
  }
  return found;
}
