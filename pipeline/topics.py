"""The fixed list of topics Atlas Meridian tracks.

Each topic has a few example sentences written in the style of UN speeches.
Together with the hand-labelled passages in training/labelled_passages.jsonl,
these teach a classifier what each topic sounds like, so they should describe
what a speaker *says* about the topic, not just list keywords. Editing them
changes the results — rerun analyze_speeches.py afterwards (it reuses cached
work, so it's quick).
"""

TOPICS = [
    {
        "id": "peace",
        "label": "Peace & conflict",
        "examples": [
            "We call for an immediate ceasefire and a peaceful settlement of the armed conflict.",
            "The war has caused immense suffering and threatens international peace and security.",
            "We support the peacekeeping operations of the United Nations and negotiations between the parties.",
            "Aggression against a sovereign state and the occupation of its territory must end.",
        ],
    },
    {
        "id": "nuclear",
        "label": "Nuclear weapons & disarmament",
        "examples": [
            "The nuclear arms race threatens the survival of humanity and must be halted.",
            "We call for general and complete disarmament under strict international control.",
            "All states should sign the treaty on the non-proliferation of nuclear weapons and ban nuclear testing.",
            "Chemical and biological weapons of mass destruction must be eliminated.",
        ],
    },
    {
        "id": "terrorism",
        "label": "Terrorism",
        "examples": [
            "We condemn terrorism in all its forms and manifestations.",
            "Terrorist groups and violent extremism threaten our citizens and our region.",
            "The international community must cut off the financing of terrorist organisations.",
        ],
    },
    {
        "id": "human_rights",
        "label": "Human rights",
        "examples": [
            "Respect for human rights and fundamental freedoms is a universal obligation.",
            "We condemn torture, arbitrary detention and the persecution of minorities.",
            "Apartheid and racial discrimination are crimes against the dignity of mankind.",
            "Freedom of expression and the rights of every individual must be protected.",
        ],
    },
    {
        "id": "democracy",
        "label": "Democracy & governance",
        "examples": [
            "Free and fair elections, the rule of law and accountable institutions are the foundation of our state.",
            "We are consolidating democracy and fighting corruption in public administration.",
            "Good governance and transparent institutions build the trust of our citizens.",
        ],
    },
    {
        "id": "climate",
        "label": "Climate change & environment",
        "examples": [
            "Climate change is an existential threat, and rising sea levels endanger small island states.",
            "We must cut greenhouse gas emissions and meet the commitments of the Paris Agreement.",
            "Protecting the environment, biodiversity and our oceans is a shared responsibility.",
            "Droughts, floods and desertification are destroying livelihoods.",
        ],
    },
    {
        "id": "development",
        "label": "Development & poverty",
        "examples": [
            "Eradicating poverty and hunger remains our most urgent priority.",
            "Developing countries need investment in education, infrastructure and economic growth.",
            "We are committed to achieving the Sustainable Development Goals.",
            "The gap between rich and poor nations continues to widen.",
        ],
    },
    {
        "id": "trade",
        "label": "Trade & the global economy",
        "examples": [
            "An open, fair and rules-based multilateral trading system benefits all nations.",
            "Protectionism, falling commodity prices and unfair terms of trade harm our exports.",
            "We need a new international economic order and fair access to markets.",
        ],
    },
    {
        "id": "debt",
        "label": "Debt & finance",
        "examples": [
            "The external debt burden is crushing developing economies and must be relieved.",
            "International financial institutions must reform and provide affordable financing.",
            "Debt servicing consumes resources that should be spent on our people.",
        ],
    },
    {
        "id": "decolonisation",
        "label": "Decolonisation & self-determination",
        "examples": [
            "The remaining colonial territories must be granted independence without delay.",
            "We support the right of peoples to self-determination and freedom from colonial rule.",
            "Colonialism and foreign domination must be eliminated in all its forms.",
        ],
    },
    {
        "id": "un_reform",
        "label": "UN reform",
        "examples": [
            "The Security Council must be reformed to reflect today's world and include more permanent members.",
            "We support revitalising the General Assembly and making the United Nations more effective.",
            "The veto power should be limited and the working methods of the Council made more transparent.",
        ],
    },
    {
        "id": "health",
        "label": "Health & pandemics",
        "examples": [
            "The COVID-19 pandemic has exposed the weaknesses of our health systems.",
            "Equitable access to vaccines and medicines must be guaranteed for all countries.",
            "We are fighting HIV/AIDS, malaria, Ebola and other diseases.",
        ],
    },
    {
        "id": "migration",
        "label": "Migration & refugees",
        "examples": [
            "Millions of refugees and displaced persons need protection and humanitarian assistance.",
            "Migration must be safe, orderly and regular, and the rights of migrants respected.",
            "Our country hosts a large number of refugees fleeing conflict.",
        ],
    },
    {
        "id": "food_water",
        "label": "Food & water security",
        "examples": [
            "Food insecurity and famine threaten millions of people.",
            "Access to clean water and sustainable agriculture are essential for survival.",
            "Rising food prices and failed harvests are causing hunger in our region.",
        ],
    },
    {
        "id": "gender",
        "label": "Gender equality",
        "examples": [
            "Gender equality and the empowerment of women and girls are central to our policies.",
            "We must end violence against women and ensure their full participation in public life.",
            "Girls must have equal access to education.",
        ],
    },
    {
        "id": "technology",
        "label": "Technology & cyber",
        "examples": [
            "Artificial intelligence and digital technologies are transforming our societies.",
            "Cyber attacks and disinformation threaten our security and democracy.",
            "We must close the digital divide and govern new technologies responsibly.",
        ],
    },
]

# Example "filler" passages that belong to no topic. They teach the classifier
# that ceremonial text exists, so it isn't forced into a real topic.
NONE_EXAMPLES = [
    "I congratulate you, Mr. President, on your election to the presidency of the General Assembly.",
    "I pay tribute to the Secretary-General for his tireless efforts and dedication.",
    "We reaffirm our commitment to the purposes and principles of the Charter of the United Nations.",
    "This anniversary session is a historic occasion for our Organization.",
    "Thank you, Mr. President. I conclude my statement.",
]
